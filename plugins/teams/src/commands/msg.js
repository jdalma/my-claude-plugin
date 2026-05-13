/**
 * `my-team msg` — append a free-form message to a worker's inbox.md
 * and send tmux trigger. Implements AC-8.
 */

import { readFileSync } from 'fs';
import { loadManifest } from './_manifest.js';
import { setStateRoot } from '../lib/state-root.js';
import { queueInboxInstruction } from '../lib/tmux-comm.js';

export async function runMsg(opts) {
    if (!opts.team) throw new Error('--team is required');
    if (!opts.to) throw new Error('--to is required');

    let body = opts.body;
    if (!body && opts.fromFile) {
        body = readFileSync(opts.fromFile, 'utf-8');
    }
    if (!body) throw new Error('--body or --from-file is required');

    const manifest = loadManifest(opts.team, opts.stateRoot);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);

    const worker = manifest.workers.find((w) => w.name === opts.to);
    if (!worker) {
        throw new Error(`Worker '${opts.to}' not in team '${opts.team}'. Workers: ${manifest.workers.map((w) => w.name).join(', ')}`);
    }

    // Use parent dir of state_root as cwd for the inbox path helper.
    // (Inbox lives under <state_root>/workers/<name>/inbox.md, but OMC's
    // appendToInbox builds `.omc/state/team/<team>/workers/...` relative to
    // cwd, so we pass state_root's parent as cwd so that prefix lands inside
    // our state_root.)
    // The simplest correct path: we know inbox file location from manifest.
    const inboxPath = worker.inbox_path;
    const { appendFile } = await import('fs/promises');
    const entry = `\n\n---\n${body}\n_queued: ${new Date().toISOString()}_\n`;
    await appendFile(inboxPath, entry, 'utf-8');

    if (opts.noTrigger) {
        console.log(`[my-team] Appended to ${inboxPath} (no trigger sent)`);
        return;
    }

    // Send trigger via tmux send-keys
    const { sendTmuxTrigger } = await import('../lib/tmux-comm.js');
    const ok = await sendTmuxTrigger(worker.pane_id, 'check-inbox');
    console.log(`[my-team] Message delivered to '${opts.to}' (trigger: ${ok ? 'sent' : 'failed'})`);
}
