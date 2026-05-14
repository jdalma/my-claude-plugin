/**
 * `my-team start` — boot a multi-project worker team.
 *
 * Implements AC-1 through AC-7 + AC-28 + AC-29.
 *
 * Flow:
 *  1. Resolve config (file or inline)
 *  2. Validate all workers (cwd exists, CLI on PATH, name pattern)
 *  3. Reject if team with same name already running (AC-28)
 *  4. Set MY_TEAM_STATE_ROOT so state-paths uses our absolute root
 *  5. Create tmux topology with per-worker cwd
 *  6. For each worker: ensure state dir, write task file (if any),
 *     write AGENTS.md overlay, compose initial inbox.md
 *  7. Spawn worker CLI in each pane, wait for ready
 *  8. Send startup trigger message
 *  9. Persist manifest for status/shutdown to find
 */

import { execFileSync } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

import { loadConfig, autoDiscoverConfig, parseInlineWorkerSpec, validateConfig } from '../config/parser.js';
import { setStateRoot } from '../lib/state-root.js';
import {
    createTeamSession, spawnWorkerInPane, waitForPaneReady,
    sendToWorker, isUnixLikeOnWindows, sanitizeName,
} from '../lib/tmux-session.js';
import { tmuxShell, tmuxExecAsync } from '../lib/tmux-utils.js';
import {
    generateWorkerOverlay, composeInitialInbox, ensureWorkerStateDir,
    generateTriggerMessage,
} from '../lib/worker-bootstrap.js';
import { writeTask, nextTaskId } from '../lib/task-ops.js';
import { atomicWriteJson } from '../lib/fs-utils.js';

/** AGENT_TYPE → CLI binary name + install hint. */
const AGENT_CLI = {
    claude: { bin: 'claude', hint: 'npm install -g @anthropic-ai/claude-code' },
    codex: { bin: 'codex', hint: 'npm install -g @openai/codex' },
    gemini: { bin: 'gemini', hint: 'npm install -g @google/gemini-cli' },
    cursor: { bin: 'cursor-agent', hint: 'install cursor-agent CLI' },
};

function commandExists(cmd) {
    try {
        const lookup = process.platform === 'win32' ? 'where' : 'which';
        execFileSync(lookup, [cmd], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/** Check no tmux session conflicts with this team name (AC-28). */
function isTeamAlreadyRunning(teamName) {
    try {
        const output = tmuxShell("list-sessions -F '#{session_name}'", {
            timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
        });
        const prefix = `my-team-${sanitizeName(teamName)}-`;
        return output.trim().split('\n').some((s) => s.startsWith(prefix));
    } catch {
        return false; // no tmux server yet
    }
}

/**
 * Resolve config from CLI args.
 *  Priority:
 *    1. --config <path>
 *    2. auto-discover ./my-team.json or ./team.json in callerCwd
 *    3. inline --worker (--name + --worker name:agent:cwd ...)
 */
export function resolveConfig(opts, callerCwd) {
    // Inline mode: --name + at least one --worker
    if (Array.isArray(opts.worker) && opts.worker.length > 0) {
        if (!opts.name) {
            throw new Error('--name is required when using inline --worker flags');
        }
        const workers = opts.worker.map((spec) => parseInlineWorkerSpec(spec));
        return validateConfig({ team_name: opts.name, workers });
    }
    // File mode
    let configPath = opts.config;
    if (!configPath) {
        configPath = autoDiscoverConfig(callerCwd);
        if (!configPath) {
            throw new Error(
                'No config file. Pass --config <path>, or place my-team.json / team.json in current directory, or use inline --worker.'
            );
        }
    }
    return loadConfig(configPath);
}

/**
 * Validate that every worker's agent CLI is on PATH (AC-29).
 */
function validateAgentCLIs(config) {
    for (const w of config.workers) {
        const info = AGENT_CLI[w.agent_type];
        if (!info) throw new Error(`Unknown agent_type for worker '${w.name}': ${w.agent_type}`);
        if (!commandExists(info.bin)) {
            throw new Error(
                `Worker '${w.name}' requires '${info.bin}', but command not found. Install: ${info.hint}`
            );
        }
    }
}

export async function runStart(opts) {
    const callerCwd = process.cwd();
    const config = resolveConfig(opts, callerCwd);

    // AC-29: agent CLI existence
    validateAgentCLIs(config);

    // AC-28: refuse if already running
    if (isTeamAlreadyRunning(config.team_name)) {
        throw new Error(
            `Team '${config.team_name}' is already running. Use 'my-team shutdown --team ${config.team_name}' first.`
        );
    }

    // State root setup: env var so OMC-borrowed modules find our root
    process.env.MY_TEAM_STATE_ROOT = config.state_root;
    setStateRoot(config.state_root);

    if (opts.dryRun) {
        console.log('# my-team start --dry-run');
        console.log(JSON.stringify({
            team_name: config.team_name,
            state_root: config.state_root,
            workers: config.workers.map((w) => ({
                name: w.name, cwd: w.cwd, agent_type: w.agent_type, has_task: Boolean(w.task),
            })),
        }, null, 2));
        return { dryRun: true, config };
    }

    await mkdir(config.state_root, { recursive: true });

    // Build worker specs (name + cwd) for createTeamSession
    const workerSpecs = config.workers.map((w) => ({ name: w.name, cwd: w.cwd }));

    console.log(`[my-team] Creating tmux topology for team '${config.team_name}' with ${workerSpecs.length} worker(s)...`);

    const session = await createTeamSession(config.team_name, workerSpecs, {
        newWindow: config.new_window,
    });
    console.log(`[my-team] Session: ${session.sessionName} (mode: ${session.sessionMode})`);
    console.log(`[my-team] Leader pane: ${session.leaderPaneId}`);

    // For each worker: state dir, task file, AGENTS.md overlay, initial inbox, spawn CLI
    const manifest = {
        team_name: config.team_name,
        state_root: config.state_root,
        session_name: session.sessionName,
        session_mode: session.sessionMode,
        leader_pane: session.leaderPaneId,
        started_at: new Date().toISOString(),
        workers: [],
    };

    for (let i = 0; i < config.workers.length; i++) {
        const w = config.workers[i];
        const pane = session.workerPanes[i];
        if (!pane) {
            throw new Error(`tmux did not return a pane for worker '${w.name}'`);
        }

        // 1. state directory
        await ensureWorkerStateDir(config.team_name, w.name, config.state_root.replace(/\/[^/]+$/, ''));
        const workerDir = join(config.state_root, 'workers', w.name);
        await mkdir(workerDir, { recursive: true });

        // 2. task file (if config.task present)
        let taskId = null;
        const tasks = [];
        if (w.task) {
            taskId = nextTaskId(config.state_root.replace(/\/[^/]+$/, ''), config.team_name);
            const task = {
                id: taskId,
                subject: w.task.subject,
                description: w.task.description,
                status: 'pending',
                owner: w.name,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            writeTask(config.state_root.replace(/\/[^/]+$/, ''), config.team_name, task);
            tasks.push({ id: taskId, subject: w.task.subject, description: w.task.description });
        }

        // 3. AGENTS.md overlay (per worker)
        const overlay = generateWorkerOverlay({
            teamName: config.team_name,
            workerName: w.name,
            agentType: w.agent_type,
            tasks,
            bootstrapInstructions: w.extra_prompt,
            instructionStateRoot: config.state_root,
            cwd: w.cwd,
        });
        const overlayPath = join(workerDir, 'AGENTS.md');
        await writeFile(overlayPath, overlay, 'utf-8');

        // 4. initial inbox.md
        const inboxContent = w.task
            ? `# Initial Inbox — ${w.name}\n\nYour first task is #${taskId}: ${w.task.subject}\n\nDetails:\n${w.task.description}\n\nFollow AGENTS.md protocol.\n`
            : `# Initial Inbox — ${w.name}\n\nNo task assigned yet. Wait for instructions via mailbox or this inbox.\n`;
        const inboxPath = join(workerDir, 'inbox.md');
        await writeFile(inboxPath, inboxContent, 'utf-8');

        // 5. spawn CLI in pane
        const agentBin = AGENT_CLI[w.agent_type].bin;
        const launchArgs = Array.isArray(w.launch_args) ? w.launch_args : [];

        // Warn on known dangerous flags but do not block — caller owns the risk.
        const dangerousFlags = launchArgs.filter((a) => /^--dangerously-/.test(a));
        if (dangerousFlags.length > 0) {
            process.stderr.write(
                `[my-team] worker '${w.name}' launching ${agentBin} with dangerous flag(s): ${dangerousFlags.join(' ')}\n`
            );
        }

        const startConfig = {
            teamName: config.team_name,
            launchBinary: agentBin,
            launchArgs,
            envVars: {
                MY_TEAM_WORKER: `${config.team_name}/${w.name}`,
                MY_TEAM_STATE_ROOT: config.state_root,
                OMC_TEAM_WORKER: `${config.team_name}/${w.name}`, // OMC compat
                ...(w.env || {}),
            },
        };
        await spawnWorkerInPane(session.sessionName, pane.paneId, startConfig);
        const argsHint = launchArgs.length > 0 ? ` args=[${launchArgs.join(' ')}]` : '';
        console.log(`[my-team] Spawned worker '${w.name}' in pane ${pane.paneId} (cwd: ${w.cwd}, cli: ${agentBin}${argsHint})`);

        manifest.workers.push({
            name: w.name,
            pane_id: pane.paneId,
            cwd: w.cwd,
            agent_type: w.agent_type,
            task_id: taskId,
            overlay_path: overlayPath,
            inbox_path: inboxPath,
        });
    }

    // Wait for all panes ready (best effort), then send startup triggers
    console.log('[my-team] Waiting for workers to be ready...');
    await Promise.all(
        manifest.workers.map((w) => waitForPaneReady(w.pane_id, { timeoutMs: 30000 }))
    );

    for (const w of manifest.workers) {
        const trigger = generateTriggerMessage(config.team_name, w.name, config.state_root);
        await sendToWorker(session.sessionName, w.pane_id, trigger);
    }
    console.log('[my-team] Startup triggers sent. Team is live.');

    // In detached mode the leader pane is just an empty shell that no one
    // is typing in — auto-start `my-team monitor` there so the user sees
    // worker-to-worker traffic the moment they attach.
    //
    // In in-place mode the leader pane is the user's own pane (they ran
    // `my-team start` from there). Auto-running monitor would lock their
    // keyboard input, so we only print a tip.
    if (session.sessionMode === 'detached-session') {
        try {
            await tmuxExecAsync([
                'send-keys', '-t', session.leaderPaneId,
                `my-team monitor ${config.team_name}`, 'Enter',
            ]);
            console.log(`[my-team] Auto-started 'my-team monitor ${config.team_name}' in leader pane`);
        } catch (err) {
            console.warn(`[my-team] Could not auto-start monitor: ${err.message}`);
        }
    } else {
        console.log(`[my-team] Tip: run 'my-team monitor ${config.team_name}' in the leader pane to watch worker traffic`);
    }

    // Persist manifest for status/shutdown
    const manifestPath = join(config.state_root, 'manifest.json');
    atomicWriteJson(manifestPath, manifest);
    console.log(`[my-team] Manifest: ${manifestPath}`);

    return { dryRun: false, manifest };
}
