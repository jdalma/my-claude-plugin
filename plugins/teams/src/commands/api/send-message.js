/**
 * `my-team api send-message` — worker → worker (or worker → leader) mailbox.
 *
 * Input JSON:
 *   { team_name, from_worker, to_worker, body }
 *
 * Special recipient `leader-fixed` writes to the leader inbox file
 * (state_root/leader/inbox.md) instead of a mailbox.
 */

import { loadManifest } from '../_manifest.js';
import { setStateRoot } from '../../lib/state-root.js';
import { queueDirectMessage } from '../../lib/tmux-comm.js';
import { appendMessageEvent } from '../../lib/events.js';
import { mkdir, appendFile } from 'fs/promises';
import { join, dirname } from 'path';

export async function runApiSendMessage(input) {
    const { team_name, from_worker, to_worker, body } = input;
    if (!team_name) throw new Error('team_name is required');
    if (!from_worker) throw new Error('from_worker is required');
    if (!to_worker) throw new Error('to_worker is required');
    if (typeof body !== 'string' || !body) throw new Error('body is required');

    const manifest = loadManifest(team_name);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);

    // leader-fixed: append to leader inbox file
    if (to_worker === 'leader-fixed') {
        const leaderInbox = join(manifest.state_root, 'leader', 'inbox.md');
        await mkdir(dirname(leaderInbox), { recursive: true });
        const entry = `\n\n---\nFrom: ${from_worker}\nAt: ${new Date().toISOString()}\n\n${body}\n`;
        await appendFile(leaderInbox, entry, 'utf-8');
        await appendMessageEvent(manifest.state_root, { from: from_worker, to: to_worker, body });
        return { ok: true, delivered_to: 'leader-fixed', path: leaderInbox };
    }

    // peer worker: write to mailbox + tmux trigger
    const recipient = manifest.workers.find((w) => w.name === to_worker);
    if (!recipient) {
        throw new Error(`Recipient '${to_worker}' not in team '${team_name}'`);
    }

    const parentDir = manifest.state_root.replace(/\/[^/]+$/, '');
    const message = await queueDirectMessage(team_name, from_worker, to_worker, body, recipient.pane_id, parentDir);
    await appendMessageEvent(manifest.state_root, { from: from_worker, to: to_worker, body });
    return { ok: true, delivered_to: to_worker, message_id: message.message_id };
}
