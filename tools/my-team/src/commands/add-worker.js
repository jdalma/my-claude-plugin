/**
 * `my-team add-worker` — add ONE worker to an ALREADY-RUNNING team mid-session.
 *
 * Counterpart to `start` (AC-28 rejects a second `start` on a live team; this
 * command REQUIRES the team be live). The single sufficient condition for the
 * new worker to send/receive peer messages is its presence in
 * `manifest.workers` — `send-message` enforces roster membership per call
 * (send-message.js:58,65). So the manifest append is the transaction commit
 * point; everything before it is reversible by killing the new pane, and
 * nothing after it can fail destructively.
 *
 * Existing workers learn about the new peer via an in-pane notice (the only
 * runtime-awareness channel — a running worker CLI has already loaded its
 * AGENTS.md, so rewriting it on disk would not reach the live LLM). Per the
 * confirmed design decision we do NOT rewrite existing workers' AGENTS.md.
 *
 * The tmux-touching functions are injected via `deps` so the validation /
 * manifest / rollback logic is unit-testable without a real tmux session.
 */

import { join } from 'path';
import { writeFile } from 'fs/promises';

import { loadManifest, manifestPathForTeam } from './_manifest.js';
import { WORKER_NAME_PATTERN, validateWorker } from '../config/parser.js';
import { AGENT_CLI, validateAgentCLIs } from './start.js';
import { sanitizeName } from '../lib/team-name.js';
import { ensureWorkerStateDir, generateWorkerOverlay } from '../lib/worker-bootstrap.js';
import { atomicWriteJson } from '../lib/fs-utils.js';
import {
    isWorkerAlive, addWorkerPane, applyTeamLayout, sendToWorker,
    spawnWorkerInPane, waitForPaneReady,
} from '../lib/tmux-session.js';
import { tmuxExecAsync } from '../lib/tmux-utils.js';

const MAX_WORKERS = 10;

export async function runAddWorker(opts, deps = {}) {
    const {
        isWorkerAlive: _isWorkerAlive = isWorkerAlive,
        addWorkerPane: _addWorkerPane = addWorkerPane,
        spawnWorkerInPane: _spawnWorkerInPane = spawnWorkerInPane,
        waitForPaneReady: _waitForPaneReady = waitForPaneReady,
        sendToWorker: _sendToWorker = sendToWorker,
        killPane: _killPane = (id) => tmuxExecAsync(['kill-pane', '-t', id]),
    } = deps;

    // ── Step 1: validation gates (no side effects; throw on failure) ──
    if (!opts.team) throw new Error('--team is required');
    if (!opts.name) throw new Error('--name is required');
    if (!opts.cwd) throw new Error('--cwd is required');
    if (!opts.agentType) throw new Error('--agent-type is required');

    // Commander camelCases --agent-type → opts.agentType; the validators read
    // snake_case w.agent_type, so map explicitly (a bare opts.agent_type would
    // be undefined and slip through to a crash at spawn).
    const newWorker = { name: opts.name, cwd: opts.cwd, agent_type: opts.agentType };

    const manifest = loadManifest(opts.team, opts.stateRoot);

    // Liveness: the team must actually be live. Anchor the new pane on the
    // first ALIVE worker pane — not blindly workers[0], which may have crashed
    // while the rest of the team is fine (a dead anchor would make the later
    // split-window fail). The host/leader pane is excluded: in split-pane mode
    // it is the user's own pane and always reads alive, which would not prove
    // the team is up. _isWorkerAlive is async, so iterate explicitly — a
    // `.find(async …)` would treat every Promise as truthy and skip the check.
    let anchor = null;
    for (const w of manifest.workers) {
        if (await _isWorkerAlive(w.pane_id)) { anchor = w; break; }
    }
    if (!anchor) {
        throw new Error(`Team '${opts.team}' session is not live (no alive worker pane). Is the team running?`);
    }

    if (manifest.workers.length + 1 > MAX_WORKERS) {
        throw new Error(`workers cannot exceed ${MAX_WORKERS}. Team already has ${manifest.workers.length}.`);
    }

    if (!WORKER_NAME_PATTERN.test(opts.name)) {
        throw new Error(`--name must match ${WORKER_NAME_PATTERN}. Got: ${JSON.stringify(opts.name)}`);
    }
    if (manifest.workers.some((w) => w.name === opts.name)) {
        throw new Error(`Duplicate worker name '${opts.name}' — already in team '${opts.team}'.`);
    }
    const sn = sanitizeName(opts.name);
    if (manifest.workers.some((w) => sanitizeName(w.name) === sn)) {
        throw new Error(`Worker name '${opts.name}' collides with an existing worker after sanitization ('${sn}').`);
    }

    // Field-level validation (cwd exists+dir, agent_type whitelist, etc.).
    // seed `seen` with existing names so a dup is caught here too. validateWorker
    // returns a normalized worker whose `cwd` is tilde-EXPANDED — use that from
    // here on, so `~/foo` reaches tmux split-window and the manifest as the
    // absolute path (matching what start.js stores), never the literal "~/foo".
    const validated = validateWorker(
        newWorker, manifest.workers.length, new Set(manifest.workers.map((w) => w.name))
    );
    const cwd = validated.cwd;

    // Agent CLI on PATH. validateAgentCLIs iterates config.workers, so wrap.
    validateAgentCLIs({ workers: [newWorker] });

    // ── Step 2: state dir + new worker AGENTS.md (idempotent; no pane yet) ──
    const stateRoot = manifest.state_root;
    await ensureWorkerStateDir(opts.team, opts.name, stateRoot);

    // New roster = existing workers + the newcomer. Existing roles are not in
    // the manifest (only start-time config had them), so they render with empty
    // role text — an accepted limitation of the no-rewrite design.
    const teamRoster = [
        ...manifest.workers.map((w) => ({ name: w.name, agentType: w.agent_type, role: '' })),
        { name: opts.name, agentType: opts.agentType, role: '' },
    ];
    const overlay = generateWorkerOverlay({
        teamName: opts.team,
        workerName: opts.name,
        agentType: opts.agentType,
        bootstrapInstructions: '',
        instructionStateRoot: stateRoot,
        cwd,
        teamRoster,
    });
    const overlayPath = join(stateRoot, 'workers', opts.name, 'AGENTS.md');
    await writeFile(overlayPath, overlay, 'utf-8');

    // ── Step 3: split a new pane (every failure past here kills this pane) ──
    const { paneId } = await _addWorkerPane(
        manifest.session_name, anchor.pane_id, { name: opts.name, cwd }
    );

    try {
        // ── Step 4: spawn the worker CLI (full envVars block, like start) ──
        const startConfig = {
            teamName: opts.team,
            launchBinary: AGENT_CLI[opts.agentType].bin,
            launchArgs: Array.isArray(opts.launchArgs) ? opts.launchArgs : [],
            envVars: {
                MY_TEAM_WORKER: `${opts.team}/${opts.name}`,
                MY_TEAM_STATE_ROOT: stateRoot,
                OMC_TEAM_WORKER: `${opts.team}/${opts.name}`,
            },
        };
        await _spawnWorkerInPane(manifest.session_name, paneId, startConfig);

        // ── Step 5: wait for the pane to be ready ──
        await _waitForPaneReady(paneId, { timeoutMs: 30000 });

        // ── Step 6: re-assert label + re-tile (cosmetic; ignore failures) ──
        try { await tmuxExecAsync(['set-option', '-p', '-t', paneId, '@worker_name', opts.name]); } catch { /* ignore */ }
        try { await applyTeamLayout(manifest.session_name); } catch { /* ignore */ }

        // ── Step 7: manifest reload + append (commit point) ──
        // Reload so we don't clobber a concurrent change and so we abort if the
        // team was shut down mid-operation (manifest gone → loadManifest throws).
        let fresh;
        try {
            fresh = loadManifest(opts.team, opts.stateRoot);
        } catch {
            throw new Error('team was shut down mid-operation (manifest gone)');
        }
        fresh.workers.push({
            name: opts.name,
            pane_id: paneId,
            cwd,
            agent_type: opts.agentType,
            overlay_path: overlayPath,
        });
        atomicWriteJson(manifestPathForTeam(opts.team, opts.stateRoot), fresh);
    } catch (err) {
        // Rollback: discard the orphan pane, leave the manifest untouched.
        try { await _killPane(paneId); } catch { /* best effort */ }
        throw err;
    }

    // ── Step 8: notifications (best-effort; never roll back past here) ──
    try {
        await _sendToWorker(
            manifest.session_name, paneId,
            `Team is live. Follow ${stateRoot}/workers/${opts.name}/AGENTS.md for the peer protocol; wait for user input in this pane or peer messages in your mailbox.`
        );
    } catch { /* warn-only */ }
    for (const w of manifest.workers) {
        try {
            await _sendToWorker(
                manifest.session_name, w.pane_id,
                `New peer available: ${opts.name} [${opts.agentType}] — message it via my-team api send-message.`
            );
        } catch { /* warn-only */ }
    }

    console.log(`[my-team] Added worker '${opts.name}' to team '${opts.team}' (pane ${paneId}, cwd: ${cwd}, cli: ${AGENT_CLI[opts.agentType].bin}).`);
    return { name: opts.name, pane_id: paneId, overlay_path: overlayPath };
}
