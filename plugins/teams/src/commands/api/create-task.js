/**
 * `my-team api create-task` — worker creates a new task for itself
 * or another worker, then optionally triggers the recipient.
 *
 * Input JSON: { team_name, subject, description?, assignee? }
 */

import { mkdir, appendFile } from 'fs/promises';
import { dirname } from 'path';
import { loadManifest } from '../_manifest.js';
import { setStateRoot } from '../../lib/state-root.js';
import { createTask } from '../../lib/task-ops.js';
import { sendTmuxTrigger } from '../../lib/tmux-comm.js';

export async function runApiCreateTask(input) {
    const { team_name, subject, description, assignee } = input;
    if (!team_name) throw new Error('team_name is required');
    if (!subject) throw new Error('subject is required');

    const manifest = loadManifest(team_name);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);
    const parentDir = manifest.state_root.replace(/\/[^/]+$/, '');

    const owner = assignee || '';
    const task = createTask(parentDir, team_name, {
        subject,
        description: description ?? '',
        owner,
    });

    // If assignee specified and is a known worker, append to their inbox + trigger
    if (owner) {
        const worker = manifest.workers.find((w) => w.name === owner);
        if (worker) {
            await mkdir(dirname(worker.inbox_path), { recursive: true });
            const entry = `\n\n---\nNew task #${task.id} assigned: ${task.subject}\n` +
                `Run 'my-team api read-task --input ' + JSON.stringify({team_name:'${team_name}',task_id:'${task.id}'}) + ' --json' to inspect.\n` +
                `_queued: ${new Date().toISOString()}_\n`;
            await appendFile(worker.inbox_path, entry, 'utf-8');
            await sendTmuxTrigger(worker.pane_id, 'new-task', task.id);
        }
    }
    return { ok: true, task };
}
