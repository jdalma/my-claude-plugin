/**
 * `my-team add-task` — register a new tracked task and notify the worker.
 * Implements AC-11.
 */

import { readFileSync } from 'fs';
import { appendFile } from 'fs/promises';
import { loadManifest } from './_manifest.js';
import { setStateRoot } from '../lib/state-root.js';
import { createTask } from '../lib/task-ops.js';
import { sendTmuxTrigger } from '../lib/tmux-comm.js';

export async function runAddTask(opts) {
    if (!opts.team) throw new Error('--team is required');
    if (!opts.worker) throw new Error('--worker is required');
    if (!opts.subject) throw new Error('--subject is required');

    let description = opts.description ?? '';
    if (opts.descriptionFile) {
        description = readFileSync(opts.descriptionFile, 'utf-8');
    }

    const manifest = loadManifest(opts.team, opts.stateRoot);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);

    const worker = manifest.workers.find((w) => w.name === opts.worker);
    if (!worker) {
        throw new Error(`Worker '${opts.worker}' not in team '${opts.team}'`);
    }

    // task-ops expects state_root to be the .omc/state-style root.
    // We pass manifest.state_root directly (state-paths uses MY_TEAM_STATE_ROOT env).
    const task = createTask(manifest.state_root.replace(/\/[^/]+$/, ''), opts.team, {
        id: opts.id,
        subject: opts.subject,
        description,
        owner: opts.worker,
    });
    console.log(`[my-team] Created task #${task.id} for worker '${opts.worker}'`);

    if (opts.noNotify) return;

    // Notify worker via inbox
    const entry = `\n\n---\nNew task #${task.id} assigned: ${task.subject}\n` +
        `Read your AGENTS.md task list or run 'my-team api read-task --input ' + ` +
        `JSON.stringify({team_name: '${opts.team}', task_id: '${task.id}'}) + ' --json' to inspect.\n` +
        `_queued: ${new Date().toISOString()}_\n`;
    await appendFile(worker.inbox_path, entry, 'utf-8');

    const ok = await sendTmuxTrigger(worker.pane_id, 'new-task', task.id);
    console.log(`[my-team] Notified worker '${opts.worker}' (trigger: ${ok ? 'sent' : 'failed'})`);
}
