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

import { loadManifest, manifestPathForTeam, resolveTeamManifest } from './_manifest.js';
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

    // Resolve --team as EITHER a team name OR a tmux session name (what
    // `tmux ls` shows). resolveTeamManifest scans manifests by session_name
    // when the value is not a team dir. CRITICAL: adopt the canonical team
    // name it returns — every downstream step (overlay teamName, MY_TEAM_WORKER
    // env, greeting, and the Step 7 reload via opts.team) must key off the real
    // team name, not the session-name input. Without this, a session-name input
    // would split a pane and then fail the commit-point reload (dir not found),
    // rolling back and killing the just-spawned pane.
    const { manifest, teamName } = resolveTeamManifest(opts.team, opts.stateRoot);
    opts.team = teamName;

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
        // Best-effort, matching start.js:238 — waitForPaneReady returns false on
        // timeout (it does not throw), and we deliberately ignore that: we still
        // commit the worker even if its CLI didn't signal ready within 30s, just
        // as `start` does for its initial workers. The worker may simply be slow.
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

    // ── Step 8: join greeting (the new worker announces itself) ──
    // D is the only one who can RELIABLY notify the existing team: it sends a
    // mailbox greeting (not a best-effort in-pane tmux poke) to each existing
    // peer, so a busy peer still receives it on its next self-poll. We trigger
    // this through D's startup notice — the one active signal D gets on boot —
    // because AGENTS.md alone is passive reference and would not make D act.
    // ACK (expects_reply) gives the user visibility into who has not acknowledged
    // D yet; it is NOT auto-redelivery. Existing workers reply by the
    // expects_reply discipline already in their AGENTS.md — no change to them.
    //
    // The notice embeds the ABSOLUTE overlayPath (same as start.js:259), not a
    // bare "your AGENTS.md": the worker CLI boots in its own cwd and nothing
    // wires the overlay (which lives under state_root, far from cwd) into it, so
    // without the explicit path the worker cannot find its roster and falls back
    // to an unrelated team source. overlayPath is built from runtime values
    // (state_root + worker name) — no session/team name is hardcoded.
    const greeting =
        `You just joined team '${opts.team}'. First action: read ${overlayPath} `
        + 'for the roster + peer protocol, then introduce yourself to every OTHER '
        + 'worker via send-message with expects_reply, as that file describes.';
    try {
        const sent = await _sendToWorker(manifest.session_name, paneId, greeting);
        if (sent === false) {
            // sendToWorker rejects (returns false) past its char cap or on a
            // busy/copy-mode pane. Surface it: a silently-dropped greeting means
            // the worker never learns its roster path — the exact failure this
            // command exists to prevent.
            console.warn(
                `[my-team] join greeting was NOT delivered to '${opts.name}' (pane ${paneId}). `
                + `The worker may not know its AGENTS.md path — point it to ${overlayPath} manually.`
            );
        }
    } catch { /* warn-only */ }

    console.log(`[my-team] Added worker '${opts.name}' to team '${opts.team}' (pane ${paneId}, cwd: ${cwd}, cli: ${AGENT_CLI[opts.agentType].bin}).`);
    return { name: opts.name, pane_id: paneId, overlay_path: overlayPath };
}
