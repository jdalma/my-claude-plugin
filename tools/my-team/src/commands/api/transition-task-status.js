/**
 * `my-team api transition-task-status` — worker calls this to change task status.
 *
 * Input JSON:
 *   { team_name, task_id, from, to, claim_token?, result?, ... }
 *
 * Notes:
 *  - `claim_token` is accepted but NOT verified (AC-31 noop response).
 *  - `result` (if present) is appended to task notes.
 */

import { loadManifest } from '../_manifest.js';
import { setStateRoot } from '../../lib/state-root.js';
import { transitionTaskStatus, readTask, updateTask } from '../../lib/task-ops.js';

export function runApiTransitionTaskStatus(input) {
    const { team_name, task_id, from, to, claim_token, result } = input;
    if (!team_name) throw new Error('team_name is required');
    if (!task_id) throw new Error('task_id is required');
    if (!to) throw new Error('to is required');

    const manifest = loadManifest(team_name);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);
    const parentDir = manifest.state_root.replace(/\/[^/]+$/, '');

    transitionTaskStatus(parentDir, team_name, task_id, from, to);

    if (typeof result === 'string' && result) {
        try { updateTask(parentDir, team_name, task_id, { result }); } catch { /* ignore */ }
    }

    return {
        ok: true,
        task: readTask(parentDir, team_name, task_id),
        claim_token_accepted: claim_token != null,
    };
}
