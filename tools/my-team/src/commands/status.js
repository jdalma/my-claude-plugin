/**
 * `my-team status` — show team state and worker liveness.
 *
 * my-team no longer tracks task lifecycle; status reports only workers,
 * panes, and tmux session info. Use `my-team monitor` to watch peer
 * messaging traffic.
 */

import { loadManifest } from './_manifest.js';
import { setStateRoot } from '../lib/state-root.js';
import { isWorkerAlive } from '../lib/tmux-session.js';

export async function runStatus(opts) {
    if (!opts.team) throw new Error('--team is required');
    const manifest = loadManifest(opts.team, opts.stateRoot);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);

    const workerStatus = await Promise.all(
        manifest.workers.map(async (w) => ({
            ...w,
            alive: await isWorkerAlive(w.pane_id),
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
    for (const w of workerStatus) {
        const dot = w.alive ? '●' : '○';
        console.log(`  ${dot} ${w.name.padEnd(12)} (${w.alive ? 'alive' : 'dead'})  cwd=${w.cwd}  pane=${w.pane_id}`);
    }
}
