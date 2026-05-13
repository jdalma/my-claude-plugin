/**
 * `my-team status` — show team state, workers, task counts.
 * Implements AC-15, AC-16.
 */

import { loadManifest } from './_manifest.js';
import { setStateRoot } from '../lib/state-root.js';
import { isWorkerAlive } from '../lib/tmux-session.js';
import { taskCounts, listTaskIds, readTask } from '../lib/task-ops.js';

export async function runStatus(opts) {
    if (!opts.team) throw new Error('--team is required');
    const manifest = loadManifest(opts.team, opts.stateRoot);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);

    // Worker liveness
    const workerStatus = await Promise.all(
        manifest.workers.map(async (w) => ({
            ...w,
            alive: await isWorkerAlive(w.pane_id),
        }))
    );

    // task-ops uses MY_TEAM_STATE_ROOT env when present, so we pass parent
    // dir (it just gets joined; with env set, the dir param is unused).
    const parentDirOfStateRoot = manifest.state_root.replace(/\/[^/]+$/, '');
    const counts = taskCounts(parentDirOfStateRoot, opts.team);
    const taskIds = listTaskIds(parentDirOfStateRoot, opts.team);
    const tasks = taskIds.map((id) => readTask(parentDirOfStateRoot, opts.team, id)).filter(Boolean);

    if (opts.json) {
        console.log(JSON.stringify({
            team_name: manifest.team_name,
            state_root: manifest.state_root,
            session: manifest.session_name,
            session_mode: manifest.session_mode,
            started_at: manifest.started_at,
            workers: workerStatus,
            tasks: { counts, items: tasks },
        }, null, 2));
        return;
    }

    // Human-friendly output
    console.log(`Team: ${manifest.team_name}`);
    console.log(`State root: ${manifest.state_root}`);
    console.log(`Tmux session: ${manifest.session_name} (${manifest.session_mode})`);
    console.log(`Started: ${manifest.started_at}`);
    console.log(`\nWorkers (${workerStatus.length}):`);
    for (const w of workerStatus) {
        const dot = w.alive ? '●' : '○';
        console.log(`  ${dot} ${w.name.padEnd(12)} (${w.alive ? 'alive' : 'dead'})  cwd=${w.cwd}  pane=${w.pane_id}`);
        if (w.task_id) console.log(`       boot task: #${w.task_id}`);
    }
    console.log(`\nTasks (${counts.total}):`);
    console.log(`  pending: ${counts.pending}  in_progress: ${counts.in_progress}  completed: ${counts.completed}  failed: ${counts.failed}`);
    for (const t of tasks) {
        const stPad = t.status.padEnd(11);
        const ownerPad = (t.owner || '-').padEnd(10);
        console.log(`  ${t.id.padStart(3)}  ${stPad}  ${ownerPad}  "${t.subject}"`);
    }
}
