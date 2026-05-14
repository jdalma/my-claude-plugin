/**
 * `my-team api send-message` — worker → worker mailbox.
 *
 * Input JSON:
 *   { team_name, from_worker, to_worker, body }
 *
 * `to_worker` must be a worker name in the team. The legacy
 * `leader-fixed` recipient is no longer supported: peer-to-peer model
 * (user observes each pane directly) means workers report to the user
 * via their pane stdout, not via a leader channel.
 */

import { loadManifest } from '../_manifest.js';
import { setStateRoot } from '../../lib/state-root.js';
import { queueDirectMessage } from '../../lib/tmux-comm.js';
import { appendMessageEvent } from '../../lib/events.js';

export async function runApiSendMessage(input) {
    const { team_name, from_worker, to_worker, body } = input;
    if (!team_name) throw new Error('team_name is required');
    if (!from_worker) throw new Error('from_worker is required');
    if (!to_worker) throw new Error('to_worker is required');
    if (typeof body !== 'string' || !body) throw new Error('body is required');
    if (to_worker === 'leader-fixed') {
        throw new Error(
            "'leader-fixed' recipient is no longer supported. my-team uses a peer-to-peer model — surface user-facing messages via this pane's stdout (normal CLI prompt). For worker-to-worker, use a peer worker name."
        );
    }

    const manifest = loadManifest(team_name);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);

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
