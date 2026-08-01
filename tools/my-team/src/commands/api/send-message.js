/**
 * `my-team api send-message` — worker → worker mailbox.
 *
 * Input JSON:
 *   { team_name, from_worker, to_worker, body, reply_to?, expects_reply?,
 *     to_session? }
 *
 * `to_worker` must be a worker name in the team. The legacy
 * `leader-fixed` recipient is no longer supported: peer-to-peer model
 * (user observes each pane directly) means workers report to the user
 * via their pane stdout, not via a leader channel.
 *
 * ## Cross-team delivery (`to_session`)
 *
 * With `to_session` set, the recipient is looked up in ANOTHER running team,
 * addressed by the tmux session name shown in `tmux ls`
 * (e.g. "my-team-payments-k3f9x2a1"). Omit it and behaviour is byte-identical to
 * before — same-team delivery, unchanged for every existing worker.
 *
 * Why the session name and not a team name: a manifest lives at
 * ~/.my-team/sessions/<team>/manifest.json, one per TEAM. Starting the same
 * team twice overwrites it, so two concurrent sessions of one team share a
 * single manifest and the older session's pane ids are gone. Only tmux knows
 * which panes are actually alive, so the recipient's pane is resolved from
 * tmux (via each pane's `@worker_name` option) and a dead or mistyped session
 * fails loudly instead of spooling a message nobody will read.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { loadManifest } from '../_manifest.js';
import { setStateRoot } from '../../lib/state-root.js';
import { queueDirectMessage } from '../../lib/tmux-comm.js';
import { appendMessageEvent } from '../../lib/events.js';
import { sanitizeName, validateTeamName } from '../../lib/team-name.js';
import { resolvePaneBySessionWorker } from '../../lib/tmux-utils.js';

/** Session names may carry a ":<window>" suffix in manifests but not in `tmux ls`. */
function stripWindowSuffix(name) {
    return typeof name === 'string' ? name.split(':')[0] : name;
}

/**
 * Find the manifest whose session_name matches `sessionName`.
 *
 * Note the deliberate asymmetry with the pane lookup: the manifest gives us the
 * recipient's `state_root` (where its spool lives), while tmux gives us the
 * live pane. When the same team was restarted, the manifest holds the NEWER
 * session's name — so an older session's name will not match here and the
 * caller gets a clear error rather than a message written to the wrong root.
 */
function findManifestBySession(sessionName) {
    const base = process.env.MY_TEAM_STATE_ROOT_BASE?.trim() || join(homedir(), '.my-team', 'sessions');
    const target = stripWindowSuffix(sessionName);
    let dirs = [];
    try {
        dirs = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
        dirs = [];
    }
    const seen = [];
    for (const dir of dirs) {
        const p = join(base, dir, 'manifest.json');
        if (!existsSync(p)) continue;
        let manifest;
        try {
            manifest = JSON.parse(readFileSync(p, 'utf-8'));
        } catch {
            continue; // a broken manifest must not abort the scan
        }
        if (manifest?.session_name) seen.push(stripWindowSuffix(manifest.session_name));
        if (stripWindowSuffix(manifest?.session_name) === target) return manifest;
    }
    throw new Error(
        `No team manifest found for tmux session '${sessionName}' (scanned ${base}). ` +
        `Known sessions: ${seen.length ? seen.join(', ') : '(none)'}. ` +
        `If that team was restarted, its manifest now points at the newer session — use the current name from 'tmux ls'.`
    );
}

/**
 * `deps` follows the same injection seam as runAddWorker: tests have no live
 * tmux server, so the one tmux-touching call is swappable while the disk side
 * (spool / archive / events) runs for real.
 */
export async function runApiSendMessage(input, deps = {}) {
    const resolvePane = deps.resolvePaneBySessionWorker ?? resolvePaneBySessionWorker;
    const { team_name, from_worker, to_worker, body, reply_to, expects_reply, to_session } = input ?? {};
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

    // Same-team only: with to_session set, an identically-named worker in
    // another session is a different worker entirely, so a reply can resolve.
    if (!to_session && safeFrom === safeTo && expectsReply) {
        throw new Error(
            `Self-message with expects_reply=true is not supported (from_worker === to_worker === "${safeFrom}"). ` +
            `Self-replies cannot resolve sent_pending because the same worker owns both sides; ` +
            `use expects_reply=false for self-notifications or send to a peer.`
        );
    }

    const manifest = loadManifest(team_name);
    process.env.MY_TEAM_STATE_ROOT = manifest.state_root;
    setStateRoot(manifest.state_root);

    // Both sender and recipient must be known team members. Sanitizer already
    // removed traversal characters; these checks enforce roster membership so
    // a hallucinated `from_worker` (e.g. typed into a pane by an external
    // text expander) cannot inject a peer message that has no origin in the
    // team. Without this guard, a forged `new-message:<from>` trigger could
    // arrive in a recipient pane with no trace in events.jsonl/archive,
    // because the spool write would silently succeed.
    const sender = manifest.workers.find((w) => sanitizeName(w.name) === safeFrom);
    if (!sender) {
        throw new Error(
            `Sender '${from_worker}' not in team '${team_name}'. ` +
            `Known workers: ${manifest.workers.map((w) => w.name).join(', ')}.`
        );
    }
    // Recipient resolution. Same-team (no to_session) keeps the original path
    // untouched: roster lookup + the pane id recorded in our own manifest.
    // Cross-team resolves the recipient's state_root from ITS manifest and its
    // pane from tmux — see the module header for why those come from different
    // sources.
    let recipientPaneId;
    let crossTeam = null;
    if (to_session) {
        const targetManifest = findManifestBySession(to_session);
        const targetWorker = targetManifest.workers?.find((w) => sanitizeName(w.name) === safeTo);
        if (!targetWorker) {
            const names = (targetManifest.workers ?? []).map((w) => w.name).join(', ');
            throw new Error(
                `Recipient '${to_worker}' not in team '${targetManifest.team_name}' (session '${to_session}'). ` +
                `Known workers: ${names || '(none)'}.`
            );
        }
        // tmux is authoritative for liveness: this throws if the session is
        // gone, which is exactly what we want — a spool file written for a dead
        // session would sit unread forever with the send reporting success.
        recipientPaneId = await resolvePane(to_session, targetWorker.name);
        crossTeam = {
            toTeam: targetManifest.team_name,
            toStateRoot: targetManifest.state_root,
            toSession: stripWindowSuffix(targetManifest.session_name),
            fromSession: stripWindowSuffix(manifest.session_name),
        };
    } else {
        const recipient = manifest.workers.find((w) => sanitizeName(w.name) === safeTo);
        if (!recipient) {
            throw new Error(`Recipient '${to_worker}' not in team '${team_name}'`);
        }
        recipientPaneId = recipient.pane_id;
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
        team_name, safeFrom, safeTo, body, recipientPaneId, parentDir,
        reply_to ?? null,
        expectsReply,
        crossTeam
    );

    const eventExtra = crossTeam
        ? { from_session: crossTeam.fromSession, to_session: crossTeam.toSession, to_team: crossTeam.toTeam }
        : {};
    await appendMessageEvent(manifest.state_root, {
        from: safeFrom,
        to: safeTo,
        body,
        message_id: message.message_id,
        reply_to: message.reply_to,
        expects_reply: message.expects_reply,
        ...eventExtra,
    });
    // Mirror the event into the recipient team's log too. Without this the
    // message is invisible to `my-team monitor` on the receiving side — the
    // recipient would answer a message its own timeline never recorded.
    if (crossTeam) {
        await appendMessageEvent(crossTeam.toStateRoot, {
            from: safeFrom,
            to: safeTo,
            body,
            message_id: message.message_id,
            reply_to: message.reply_to,
            expects_reply: message.expects_reply,
            from_team: team_name,
            ...eventExtra,
        });
    }

    return {
        ok: true,
        delivered_to: safeTo,
        message_id: message.message_id,
        reply_to: message.reply_to,
        expects_reply: message.expects_reply,
        ...(crossTeam ? { delivered_to_session: crossTeam.toSession, delivered_to_team: crossTeam.toTeam } : {}),
        ...(expectsReplyHint ? { hint: expectsReplyHint } : {}),
    };
}
