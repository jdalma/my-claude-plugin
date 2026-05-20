/**
 * `my-team api mailbox-list` — read a worker's mailbox.
 *
 * Input JSON:
 *   { team_name, worker, unread_only? = true }
 *
 * Returns: { ok: true, worker, messages: [...] }
 *
 * `unread_only=true` (default) filters to messages where `consumed_at` is
 * null/undefined. Set `false` to return the full mailbox.
 *
 * Phase 0 of the worker mailbox recovery work — pairs with
 * `mailbox-mark-delivered`. Self-poll discipline for workers is documented
 * in `worker-bootstrap.js` AGENTS.md template.
 *
 * Failure modes intentionally distinct from OMC's silent-empty pattern:
 *   - missing mailbox file → empty messages array (legitimate "no mail")
 *   - mailbox file present but malformed JSON → throw (callers must see this)
 */

import { readFileSync, existsSync } from 'fs';
import { loadManifest } from '../_manifest.js';
import { setStateRoot } from '../../lib/state-root.js';
import { TeamPaths, absPath } from '../../lib/state-paths.js';

export function runApiMailboxList(input) {
    const { team_name, worker, unread_only } = input ?? {};
    if (!team_name) throw new Error('team_name is required');
    if (!worker) throw new Error('worker is required');
    const onlyUnread = unread_only === undefined ? true : Boolean(unread_only);

    const manifest = loadManifest(team_name);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);

    const parentDir = manifest.state_root.replace(/\/[^/]+$/, '');
    const mailboxFile = absPath(parentDir, TeamPaths.mailbox(team_name, worker));

    if (!existsSync(mailboxFile)) {
        return { ok: true, worker, messages: [] };
    }

    let raw;
    try {
        raw = readFileSync(mailboxFile, 'utf-8');
    } catch (err) {
        throw new Error(`Cannot read mailbox at ${mailboxFile}: ${err.message}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`Mailbox at ${mailboxFile} is not valid JSON: ${err.message}`);
    }

    const all = Array.isArray(parsed?.messages) ? parsed.messages : [];
    const messages = onlyUnread ? all.filter((m) => m && m.consumed_at == null) : all;
    return { ok: true, worker, messages };
}
