/**
 * `my-team api read-task` — worker reads full task JSON.
 *
 * Input JSON: { team_name, task_id }
 */

import { loadManifest } from '../_manifest.js';
import { setStateRoot } from '../../lib/state-root.js';
import { readTask } from '../../lib/task-ops.js';

export function runApiReadTask(input) {
    const { team_name, task_id } = input;
    if (!team_name) throw new Error('team_name is required');
    if (!task_id) throw new Error('task_id is required');

    const manifest = loadManifest(team_name);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);
    const parentDir = manifest.state_root.replace(/\/[^/]+$/, '');

    const task = readTask(parentDir, team_name, task_id);
    if (!task) {
        return { ok: false, error: 'task_not_found', task_id };
    }
    return { ok: true, task };
}
