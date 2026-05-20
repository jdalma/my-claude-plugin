/**
 * Adapted from oh-my-claude-sisyphus (MIT License)
 * https://github.com/Yeachan-Heo/oh-my-claudecode
 *
 * Source: dist/team/tmux-comm.js (low-level functions only)
 * Modifications:
 *  - dispatch-queue / high-level `queue*` helpers from OMC `mcp-comm.js` are
 *    intentionally NOT borrowed. my-team uses the simple write-then-notify
 *    pattern directly: write file, then send-keys trigger.
 *  - import paths rewired to local modules.
 */

import { mkdir, appendFile, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

import { sendToWorker } from './tmux-session.js';
import { TeamPaths, absPath } from './state-paths.js';

function mailboxPath(teamName, workerName, cwd) {
    return absPath(cwd, TeamPaths.mailbox(teamName, workerName));
}

async function readMailboxFile(teamName, workerName, cwd) {
    const canonicalPath = mailboxPath(teamName, workerName, cwd);
    try {
        const raw = await readFile(canonicalPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.messages)) {
            return { worker: workerName, messages: parsed.messages };
        }
    } catch {
        // mailbox not yet created — return empty
    }
    return { worker: workerName, messages: [] };
}

async function writeMailboxFile(teamName, workerName, cwd, mailbox) {
    const canonicalPath = mailboxPath(teamName, workerName, cwd);
    await mkdir(join(canonicalPath, '..'), { recursive: true });
    await writeFile(canonicalPath, JSON.stringify(mailbox, null, 2), 'utf-8');
}

/**
 * Send a short tmux trigger to a worker pane. Message MUST be < 200 chars.
 * Returns false on error — never throws.
 */
export async function sendTmuxTrigger(paneId, triggerType, payload) {
    const message = payload ? `${triggerType}:${payload}` : triggerType;
    if (message.length > 200) {
        console.warn(`[tmux-comm] sendTmuxTrigger: message rejected (${message.length} chars exceeds 200 char limit)`);
        return false;
    }
    try {
        return await sendToWorker('', paneId, message);
    } catch {
        return false;
    }
}

/**
 * Write an instruction to a worker inbox.md, then send tmux trigger.
 * Write-then-notify pattern: file is written first, trigger is sent after.
 */
export async function queueInboxInstruction(teamName, workerName, instruction, paneId, cwd) {
    const inboxPath = absPath(cwd, TeamPaths.inbox(teamName, workerName));
    await mkdir(join(inboxPath, '..'), { recursive: true });
    const entry = `\n\n---\n${instruction}\n_queued: ${new Date().toISOString()}_\n`;
    await appendFile(inboxPath, entry, 'utf-8');
    return await sendTmuxTrigger(paneId, 'check-inbox');
}

/**
 * Send a direct message from one worker to another via mailbox + tmux trigger.
 *
 * `replyTo` (optional) is the `message_id` of the message this one answers.
 * It lets the original sender match an async reply to its question via
 * `mailbox-list` — workers never block waiting for a reply.
 */
export async function queueDirectMessage(teamName, fromWorker, toWorker, body, toPaneId, cwd, replyTo = null) {
    const mailbox = await readMailboxFile(teamName, toWorker, cwd);
    const message = {
        message_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from_worker: fromWorker,
        to_worker: toWorker,
        body,
        created_at: new Date().toISOString(),
        consumed_at: null,
        reply_to: replyTo ?? null,
    };
    mailbox.messages.push(message);
    await writeMailboxFile(teamName, toWorker, cwd, mailbox);

    const notified = await sendTmuxTrigger(toPaneId, 'new-message', fromWorker);
    if (notified) {
        const updated = await readMailboxFile(teamName, toWorker, cwd);
        const entry = updated.messages.find((c) => c.message_id === message.message_id);
        if (entry) entry.notified_at = new Date().toISOString();
        await writeMailboxFile(teamName, toWorker, cwd, updated);
    }
    return message;
}

/**
 * Broadcast a message to all workers (write to each mailbox, then trigger).
 */
export async function queueBroadcastMessage(teamName, fromWorker, body, workerPanes, cwd) {
    const workerNames = Object.keys(workerPanes);
    const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const messages = [];
    for (const toWorker of workerNames) {
        const mailbox = await readMailboxFile(teamName, toWorker, cwd);
        const message = {
            message_id: messageId,
            from_worker: fromWorker,
            to_worker: toWorker,
            body,
            created_at: new Date().toISOString(),
            consumed_at: null,
            reply_to: null,
        };
        mailbox.messages.push(message);
        await writeMailboxFile(teamName, toWorker, cwd, mailbox);
        messages.push(message);
    }
    await Promise.all(
        workerNames.map((toWorker) => sendTmuxTrigger(workerPanes[toWorker], 'new-message', fromWorker))
    );
    return messages;
}

/**
 * Read all messages from a worker mailbox.
 */
export async function readMailbox(teamName, workerName, cwd) {
    const mailbox = await readMailboxFile(teamName, workerName, cwd);
    return mailbox.messages.map((m) => ({
        id: m.message_id,
        from: m.from_worker,
        body: m.body,
        createdAt: m.created_at,
        notifiedAt: m.notified_at,
    }));
}
