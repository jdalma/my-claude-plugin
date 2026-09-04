/**
 * `my-team remove-worker` — remove ONE worker from a running team mid-session.
 *
 * Exact inverse of add-worker, in reverse order: add-worker commits by
 * APPENDING to `manifest.workers` (the roster send-message enforces per call),
 * so remove commits by SPLICING it out. That single write is the transaction
 * point — once it lands, peers can no longer address the worker and the pane is
 * just a leftover process to kill.
 *
 * State (mailbox/archive/AGENTS.md, and any --worktree dir) is deliberately
 * left on disk: `shutdown` already backs the whole state_root up to `.bak`, and
 * worktree cleanup is the user's job (same rule add-worker documents).
 */

import { loadManifest, manifestPathForTeam, resolveTeamManifest } from './_manifest.js';
import { atomicWriteJson } from '../lib/fs-utils.js';
import { applyTeamLayout, sendToWorker } from '../lib/tmux-session.js';
import { tmuxExecAsync } from '../lib/tmux-utils.js';

export async function runRemoveWorker(opts, deps = {}) {
    const {
        sendToWorker: _sendToWorker = sendToWorker,
        killPane: _killPane = (id) => tmuxExecAsync(['kill-pane', '-t', id]),
    } = deps;

    if (!opts.team) throw new Error('--team is required');
    if (!opts.name) throw new Error('--name is required');

    // Same team-OR-session-name resolution as add-worker/shutdown; adopt the
    // canonical team name so the reload below keys off the real one.
    const { teamName } = resolveTeamManifest(opts.team, opts.stateRoot);
    opts.team = teamName;

    // Reload at the commit point (same reason as add-worker Step 7): don't
    // clobber a concurrent add, and abort if the team was shut down meanwhile.
    const fresh = loadManifest(opts.team, opts.stateRoot);
    const idx = fresh.workers.findIndex((w) => w.name === opts.name);
    if (idx === -1) {
        throw new Error(`Worker '${opts.name}' is not in team '${opts.team}'.`);
    }
    const [removed] = fresh.workers.splice(idx, 1);

    // Commit: from here the worker is off the roster and send-message rejects it.
    atomicWriteJson(manifestPathForTeam(opts.team, opts.stateRoot), fresh);

    // Kill the pane. Never the leader — a worker's pane_id can equal
    // leader_pane in split-pane mode only for the host, which is not a worker,
    // but guard anyway so we never take out the user's own pane.
    const killable = removed.pane_id && removed.pane_id !== fresh.leader_pane;
    if (killable) {
        try { await _killPane(removed.pane_id); } catch { /* already gone */ }
        try { await applyTeamLayout(fresh.session_name); } catch { /* cosmetic */ }
    }

    // Departure notice, mirroring add-worker's join greeting: without it a peer
    // keeps messaging a worker that no longer exists and only finds out via a
    // roster-rejection error, possibly after stalling on a reply that can't come.
    const notice =
        `Worker '${opts.name}' has LEFT team '${opts.team}'. Do not send it messages; `
        + 'if you were waiting on a reply from it, stop waiting and proceed.';
    for (const w of fresh.workers) {
        try { await _sendToWorker(fresh.session_name, w.pane_id, notice); } catch { /* best effort */ }
    }

    const paneNote = killable ? `pane ${removed.pane_id} killed` : `pane ${removed.pane_id} kept (leader)`;
    console.log(`[my-team] Removed worker '${opts.name}' from team '${opts.team}' (${paneNote}). State kept under ${fresh.state_root}.`);
    return { name: opts.name, pane_id: removed.pane_id };
}
