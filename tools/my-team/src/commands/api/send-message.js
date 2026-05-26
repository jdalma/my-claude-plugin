/**
 * `my-team api send-message` — worker → worker mailbox.
 *
 * Input JSON:
 *   { team_name, from_worker, to_worker, body, reply_to?, expects_reply? }
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
import { sanitizeName, validateTeamName } from '../../lib/team-name.js';

export async function runApiSendMessage(input) {
    const { team_name, from_worker, to_worker, body, reply_to, expects_reply } = input ?? {};
    if (!team_name) throw new Error('team_name is required');
    if (!from_worker) throw new Error('from_worker is required');
    if (!to_worker) throw new Error('to_worker is required');
    if (typeof body !== 'string' || !body) throw new Error('body is required');
    if (expects_reply !== undefined && typeof expects_reply !== 'boolean') {
        throw new Error('expects_reply must be a boolean when provided');
    }
    if (to_worker === 'leader-fixed') {
        throw new Error(
            "'leader-fixed' recipient is no longer supported. my-team uses a peer-to-peer model — surface user-facing messages via this pane's stdout (normal CLI prompt). For worker-to-worker, use a peer worker name."
        );
    }

    validateTeamName(team_name);
    const safeFrom = sanitizeName(from_worker);
    const safeTo = sanitizeName(to_worker);
    const expectsReply = Boolean(expects_reply);

    if (safeFrom === safeTo && expectsReply) {
        throw new Error(
            `Self-message with expects_reply=true is not supported (from_worker === to_worker === "${safeFrom}"). ` +
            `Self-replies cannot resolve sent_pending because the same worker owns both sides; ` +
            `use expects_reply=false for self-notifications or send to a peer.`
        );
    }

    const manifest = loadManifest(team_name);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);

    // Recipient must be a known team member. Sanitizer already removed
    // traversal characters; this check enforces team-roster membership.
    const recipient = manifest.workers.find((w) => sanitizeName(w.name) === safeTo);
    if (!recipient) {
        throw new Error(`Recipient '${to_worker}' not in team '${team_name}'`);
    }

    // Soft guard: a body containing '?' usually implies a question. Warn (not
    // throw) when expects_reply was not explicitly set. The sender remains in
    // charge — the warning surfaces only on stderr.
    let expectsReplyHint = null;
    if (expects_reply === undefined && /[?？]/.test(body)) {
        expectsReplyHint = 'body contains "?" but expects_reply was not provided — pass expects_reply:true if you need an answer';
        process.stderr.write(`[my-team] ${expectsReplyHint}\n`);
    }

    const parentDir = manifest.state_root.replace(/\/[^/]+$/, '');
    const message = await queueDirectMessage(
        team_name, safeFrom, safeTo, body, recipient.pane_id, parentDir,
        reply_to ?? null,
        expectsReply
    );
    await appendMessageEvent(manifest.state_root, {
        from: safeFrom,
        to: safeTo,
        body,
        message_id: message.message_id,
        reply_to: message.reply_to,
        expects_reply: message.expects_reply,
    });
    return {
        ok: true,
        delivered_to: safeTo,
        message_id: message.message_id,
        reply_to: message.reply_to,
        expects_reply: message.expects_reply,
        ...(expectsReplyHint ? { hint: expectsReplyHint } : {}),
    };
}
