/**
 * `my-team api mailbox-mark-delivered` — stamp `consumed_at` on a mailbox
 * message so subsequent `mailbox-list` calls (with `unread_only=true`,
 * the default) no longer return it.
 *
 * Input JSON:
 *   { team_name, worker, message_id }
 *
 * Returns: { ok: true, message_id, already_consumed?: true }
 *
 * Idempotent: re-marking an already-consumed message preserves the original
 * `consumed_at` and sets `already_consumed: true` on the response.
 *
 * Known limitation (Phase 2, not addressed here): this handler shares the
 * read-modify-write pattern of `queueDirectMessage` (tmux-comm.js:76-85).
 * Two concurrent callers can drop one update. Fixing this requires either
 * atomic write+rename or JSONL migration — a separate PR.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { loadManifest } from '../_manifest.js';
import { setStateRoot } from '../../lib/state-root.js';
import { TeamPaths, absPath } from '../../lib/state-paths.js';

export function runApiMailboxMarkDelivered(input) {
    const { team_name, worker, message_id } = input ?? {};
    if (!team_name) throw new Error('team_name is required');
    if (!worker) throw new Error('worker is required');
    if (!message_id) throw new Error('message_id is required');

    const manifest = loadManifest(team_name);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);

    const parentDir = manifest.state_root.replace(/\/[^/]+$/, '');
    const mailboxFile = absPath(parentDir, TeamPaths.mailbox(team_name, worker));

    if (!existsSync(mailboxFile)) {
        throw new Error(`mailbox not found at ${mailboxFile}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(readFileSync(mailboxFile, 'utf-8'));
    } catch (err) {
        throw new Error(`Mailbox at ${mailboxFile} is not valid JSON: ${err.message}`);
    }

    const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    const target = messages.find((m) => m && m.message_id === message_id);
    if (!target) {
        throw new Error(`message_id '${message_id}' not found in mailbox for worker '${worker}'`);
    }

    if (target.consumed_at) {
        return { ok: true, message_id, already_consumed: true };
    }

    target.consumed_at = new Date().toISOString();
    writeFileSync(mailboxFile, JSON.stringify({ ...parsed, messages }, null, 2), 'utf-8');
    return { ok: true, message_id };
}
