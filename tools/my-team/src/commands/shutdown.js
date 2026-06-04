/**
 * `my-team shutdown` — terminate a running team.
 * Implements AC-17, AC-18.
 */

import { unlink, rm, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { normalize, sep } from 'path';
import { loadManifest, manifestPathForTeam } from './_manifest.js';
import { setStateRoot } from '../lib/state-root.js';
import { killTeamSession, killWorkerPanes } from '../lib/tmux-session.js';

/**
 * Guard against wiping a dangerous path. A team's state_root is expected to be
 * a leaf session directory (e.g. ~/.my-team/sessions/<team>), several levels
 * deep and never the home dir or filesystem root. If it looks shallow or maps
 * to a sensitive path, we refuse the recursive wipe and let the caller fall
 * back to deleting only manifest.json.
 *
 * Returns true when `stateRoot` is safe to back up + remove wholesale.
 */
export function isSafeToWipe(stateRoot) {
    if (!stateRoot || typeof stateRoot !== 'string') return false;
    const norm = normalize(stateRoot).replace(/[/\\]+$/, '');
    if (!norm) return false;

    const home = normalize(homedir());
    if (norm === home) return false;
    if (norm === '/' || /^[A-Za-z]:\\?$/.test(norm)) return false; // posix root / windows drive root

    // Require at least 3 path segments below root so we never nuke a top-level
    // dir. ~/.my-team/sessions/<team> is 5+ on macOS; this is a conservative floor.
    const segments = norm.split(sep).filter(Boolean);
    if (segments.length < 3) return false;

    return true;
}

/**
 * Back up `stateRoot` to `<stateRoot>.bak` (one generation), leaving it gone
 * from its original location. A pre-existing `.bak` is removed first so we keep
 * exactly one prior generation.
 *
 * The user chose to always keep a backup, so if the atomic rename fails (e.g.
 * EXDEV across filesystems) we do NOT delete the state — we preserve it and
 * report the failure. Failure mode is "state kept, overlap persists, user
 * warned", never "state destroyed without a backup".
 *
 * Returns { backedUpTo } on success, or { backedUpTo: null, error } on failure.
 */
export async function backupAndRemoveStateRoot(stateRoot) {
    const bakPath = `${stateRoot}.bak`;
    if (existsSync(bakPath)) {
        try { await rm(bakPath, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    try {
        await rename(stateRoot, bakPath);
        return { backedUpTo: bakPath };
    } catch (err) {
        return { backedUpTo: null, error: err };
    }
}

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
        // Graceful sentinel + kill worker panes only (preserve user's host pane)
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
            // Best-effort: wait briefly so workers can react to the shutdown sentinel before kill
            await new Promise((r) => setTimeout(r, graceMs));
        }
        await killTeamSession(
            manifest.session_name,
            workerPaneIds,
            leaderPaneId,
            { sessionMode: manifest.session_mode }
        );
    }

    // Clean up state: back up the whole state_root to <state_root>.bak (one
    // generation) and remove the original, so re-running `start` with the same
    // team_name does not inherit this run's events.jsonl / archive / mailbox.
    const stateRoot = manifest.state_root;
    if (!existsSync(stateRoot)) {
        // Already gone (e.g. a second shutdown). Nothing to clean.
    } else if (!isSafeToWipe(stateRoot)) {
        // Unsafe path (too shallow / home / root): never wipe wholesale. Remove
        // only the manifest so the team reads as "not running", and warn.
        const manifestPath = manifestPathForTeam(opts.team, stateRoot);
        if (existsSync(manifestPath)) {
            try { await unlink(manifestPath); } catch { /* ignore */ }
        }
        console.warn(
            `[my-team] state_root looks unsafe to wipe (${stateRoot}); removed manifest only. ` +
            `Clear remaining state manually if needed.`
        );
    } else {
        const { backedUpTo } = await backupAndRemoveStateRoot(stateRoot);
        if (backedUpTo) {
            console.log(`[my-team] State backed up to ${backedUpTo} and cleared.`);
        } else {
            // Backup rename failed — state is intentionally kept (the user opted
            // for always-backup). Overlap will persist until cleared manually.
            console.warn(
                `[my-team] Could not back up state_root (${stateRoot}); state was NOT cleared ` +
                `to avoid data loss. Re-running 'start' with this team_name will inherit old ` +
                `state — clear it manually if that's a problem.`
            );
        }
    }

    console.log(`[my-team] Team '${opts.team}' shut down.`);
}
