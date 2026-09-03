/**
 * `my-team status` — show team state and worker liveness.
 *
 * Besides tmux liveness, each worker line surfaces what only its own files
 * know: the self-reported state from status.json (blocked + reason is the
 * one that matters) and mail that is stuck — spool files never absorbed,
 * inbox entries never consumed, questions still waiting for an answer.
 * Those are the signals of a worker that stalled without saying so.
 */

import { readdir, readFile } from 'fs/promises';

import { loadManifest } from './_manifest.js';
import { setStateRoot } from '../lib/state-root.js';
import { isWorkerAlive } from '../lib/tmux-session.js';
import { readMailboxFile } from '../lib/tmux-comm.js';
import { TeamPaths } from '../lib/state-paths.js';

async function mailAndState(teamName, workerName) {
    let state = null, reason = null;
    try {
        const s = JSON.parse(await readFile(TeamPaths.workerStatus(teamName, workerName), 'utf-8'));
        state = s.state ?? null;
        reason = s.reason ?? null;
    } catch { /* never written */ }

    let spool = 0;
    try {
        spool = (await readdir(TeamPaths.incomingSpoolDir(teamName, workerName))).filter((n) => n.endsWith('.json')).length;
    } catch { /* no spool dir */ }

    let unread = 0, sentPending = 0, oldestPendingAt = null;
    try {
        const mb = await readMailboxFile(teamName, workerName, process.cwd());
        unread = Object.keys(mb.inbox).length;
        const pending = Object.values(mb.sent_pending);
        sentPending = pending.length;
        oldestPendingAt = pending.map((p) => p.sent_at).filter(Boolean).sort()[0] ?? null;
    } catch (err) {
        reason = reason ?? `mailbox unreadable: ${err.message}`;
    }

    return { state, reason, spool, unread, sent_pending: sentPending, oldest_pending_at: oldestPendingAt };
}

function hoursSince(iso) {
    return Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
}

export async function runStatus(opts) {
    if (!opts.team) throw new Error('--team is required');
    const manifest = loadManifest(opts.team, opts.stateRoot);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);

    const workerStatus = await Promise.all(
        manifest.workers.map(async (w) => ({
            ...w,
            alive: await isWorkerAlive(w.pane_id),
            ...(await mailAndState(manifest.team_name, w.name)),
        }))
    );

    if (opts.json) {
        console.log(JSON.stringify({
            team_name: manifest.team_name,
            state_root: manifest.state_root,
            session: manifest.session_name,
            session_mode: manifest.session_mode,
            started_at: manifest.started_at,
            workers: workerStatus,
        }, null, 2));
        return;
    }

    console.log(`Team: ${manifest.team_name}`);
    console.log(`State root: ${manifest.state_root}`);
    console.log(`Tmux session: ${manifest.session_name} (${manifest.session_mode})`);
    console.log(`Started: ${manifest.started_at}`);
    console.log(`\nWorkers (${workerStatus.length}):`);
    const nameWidth = Math.max(...workerStatus.map((w) => w.name.length));
    for (const w of workerStatus) {
        const dot = w.alive ? '●' : '○';
        const pending = w.sent_pending
            ? `pending=${w.sent_pending} (oldest ${hoursSince(w.oldest_pending_at)}h)`
            : 'pending=0';
        console.log(
            `  ${dot} ${w.name.padEnd(nameWidth)} ${(w.alive ? 'alive' : 'dead').padEnd(5)}  ` +
            `state=${(w.state ?? '-').padEnd(8)} spool=${w.spool} unread=${w.unread} ${pending}  cwd=${w.cwd}`
        );
        if (w.state === 'blocked' && w.reason) console.log(`      reason: ${w.reason}`);
    }
}
