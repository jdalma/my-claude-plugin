/**
 * `my-team shutdown` — terminate a running team.
 * Implements AC-17, AC-18.
 */

import { unlink, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { loadManifest, manifestPathForTeam } from './_manifest.js';
import { setStateRoot } from '../lib/state-root.js';
import { killTeamSession, killWorkerPanes } from '../lib/tmux-session.js';

export async function runShutdown(opts) {
    if (!opts.team) throw new Error('--team is required');
    const manifest = loadManifest(opts.team, opts.stateRoot);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);

    const workerPaneIds = manifest.workers.map((w) => w.pane_id);
    const leaderPaneId = manifest.leader_pane;

    const graceMs = opts.force ? 0 : Number(process.env.MY_TEAM_GRACE_MS || 10000);

    console.log(`[my-team] Shutting down team '${opts.team}' (mode: ${manifest.session_mode}, grace: ${graceMs}ms)...`);

    if (manifest.session_mode === 'split-pane') {
        // Graceful sentinel + kill worker panes only (preserve user leader pane)
        await killWorkerPanes({
            paneIds: workerPaneIds,
            leaderPaneId,
            teamName: opts.team,
            cwd: manifest.state_root.replace(/\/[^/]+$/, ''), // for shutdown.json sentinel
            graceMs,
        });
    } else {
        // detached-session or dedicated-window: kill whole session/window
        if (graceMs > 0) {
            // Best-effort: wait briefly so workers can see the upcoming kill via inbox.md or similar
            await new Promise((r) => setTimeout(r, graceMs));
        }
        await killTeamSession(
            manifest.session_name,
            workerPaneIds,
            leaderPaneId,
            { sessionMode: manifest.session_mode }
        );
    }

    // Clean up manifest (the team is no longer running)
    const manifestPath = manifestPathForTeam(opts.team, manifest.state_root);
    if (existsSync(manifestPath)) {
        try { await unlink(manifestPath); } catch { /* ignore */ }
    }

    console.log(`[my-team] Team '${opts.team}' shut down.`);
}
