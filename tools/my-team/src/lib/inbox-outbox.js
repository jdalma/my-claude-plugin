/**
 * Adapted from oh-my-claude-sisyphus (MIT License)
 * https://github.com/Yeachan-Heo/oh-my-claudecode
 *
 * Source: dist/team/inbox-outbox.js
 * Modifications:
 *  - import paths rewired to local `./state-root.js`, `./team-name.js`, `./fs-utils.js`.
 *  - behavior is identical: JSONL byte-cursor inbox/outbox + signal files.
 */

import {
    readFileSync, existsSync, statSync, unlinkSync, renameSync, rmSync,
    openSync, readSync, closeSync,
} from 'fs';
import { join, dirname } from 'path';

import { getClaudeConfigDir } from './state-root.js';
import { sanitizeName } from './team-name.js';
import {
    appendFileWithMode, writeFileWithMode, atomicWriteJson,
    ensureDirWithMode, validateResolvedPath,
} from './fs-utils.js';
import { TeamPaths, absPath } from './state-paths.js';

const MAX_INBOX_READ_SIZE = 10 * 1024 * 1024;

function teamsDir(teamName) {
    const result = join(getClaudeConfigDir(), 'teams', sanitizeName(teamName));
    validateResolvedPath(result, join(getClaudeConfigDir(), 'teams'));
    return result;
}
function inboxPath(teamName, workerName) {
    return join(teamsDir(teamName), 'inbox', `${sanitizeName(workerName)}.jsonl`);
}
function inboxCursorPath(teamName, workerName) {
    return join(teamsDir(teamName), 'inbox', `${sanitizeName(workerName)}.offset`);
}
function outboxPath(teamName, workerName) {
    return join(teamsDir(teamName), 'outbox', `${sanitizeName(workerName)}.jsonl`);
}
function signalPath(teamName, workerName) {
    return join(teamsDir(teamName), 'signals', `${sanitizeName(workerName)}.shutdown`);
}
function drainSignalPath(teamName, workerName) {
    return join(teamsDir(teamName), 'signals', `${sanitizeName(workerName)}.drain`);
}

function ensureDir(filePath) {
    ensureDirWithMode(dirname(filePath));
}

// --- Outbox (worker -> lead) ---
export function appendOutbox(teamName, workerName, message) {
    const filePath = outboxPath(teamName, workerName);
    ensureDir(filePath);
    appendFileWithMode(filePath, JSON.stringify(message) + '\n');
}

export function rotateOutboxIfNeeded(teamName, workerName, maxLines) {
    const filePath = outboxPath(teamName, workerName);
    if (!existsSync(filePath)) return;
    try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        if (lines.length <= maxLines) return;
        const keepCount = Math.floor(maxLines / 2);
        const kept = keepCount === 0 ? [] : lines.slice(-keepCount);
        const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
        writeFileWithMode(tmpPath, kept.join('\n') + '\n');
        renameSync(tmpPath, filePath);
    } catch {
        /* non-fatal */
    }
}

export function rotateInboxIfNeeded(teamName, workerName, maxSizeBytes) {
    const filePath = inboxPath(teamName, workerName);
    if (!existsSync(filePath)) return;
    try {
        const stat = statSync(filePath);
        if (stat.size <= maxSizeBytes) return;
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        const keepCount = Math.max(1, Math.floor(lines.length / 2));
        const kept = lines.slice(-keepCount);
        const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
        writeFileWithMode(tmpPath, kept.join('\n') + '\n');
        renameSync(tmpPath, filePath);
        const cursorFile = inboxCursorPath(teamName, workerName);
        atomicWriteJson(cursorFile, { bytesRead: 0 });
    } catch {
        /* non-fatal */
    }
}

// --- Inbox (lead -> worker) ---
export function readNewInboxMessages(teamName, workerName) {
    const inbox = inboxPath(teamName, workerName);
    const cursorFile = inboxCursorPath(teamName, workerName);
    if (!existsSync(inbox)) return [];

    let offset = 0;
    if (existsSync(cursorFile)) {
        try {
            const cursor = JSON.parse(readFileSync(cursorFile, 'utf-8'));
            offset = cursor.bytesRead;
        } catch { /* reset */ }
    }

    const stat = statSync(inbox);
    if (stat.size < offset) offset = 0;
    if (stat.size <= offset) return [];

    const readSize = stat.size - offset;
    const cappedSize = Math.min(readSize, MAX_INBOX_READ_SIZE);
    if (cappedSize < readSize) {
        console.warn(`[inbox-outbox] Inbox for ${workerName} exceeds ${MAX_INBOX_READ_SIZE} bytes, reading truncated`);
    }
    const fd = openSync(inbox, 'r');
    const buffer = Buffer.alloc(cappedSize);
    try {
        readSync(fd, buffer, 0, buffer.length, offset);
    } finally {
        closeSync(fd);
    }

    const newData = buffer.toString('utf-8');
    const lastNewlineIdx = newData.lastIndexOf('\n');
    if (lastNewlineIdx === -1) return [];

    const completeData = newData.substring(0, lastNewlineIdx + 1);
    const messages = [];
    let bytesProcessed = 0;
    const lines = completeData.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    for (const line of lines) {
        if (!line.trim()) {
            bytesProcessed += Buffer.byteLength(line, 'utf-8') + 1;
            continue;
        }
        const cleanLine = line.endsWith('\r') ? line.slice(0, -1) : line;
        const lineBytes = Buffer.byteLength(line, 'utf-8') + 1;
        try {
            messages.push(JSON.parse(cleanLine));
            bytesProcessed += lineBytes;
        } catch {
            console.warn(`[inbox-outbox] Skipping malformed JSONL line for ${workerName}: ${cleanLine.slice(0, 80)}`);
            bytesProcessed += lineBytes;
        }
    }

    const newOffset = offset + (bytesProcessed > 0 ? bytesProcessed : 0);
    ensureDir(cursorFile);
    atomicWriteJson(cursorFile, { bytesRead: newOffset > offset ? newOffset : offset });
    return messages;
}

export function readAllInboxMessages(teamName, workerName) {
    const inbox = inboxPath(teamName, workerName);
    if (!existsSync(inbox)) return [];
    try {
        const content = readFileSync(inbox, 'utf-8');
        const messages = [];
        for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            try { messages.push(JSON.parse(line)); } catch { /* skip */ }
        }
        return messages;
    } catch {
        return [];
    }
}

export function clearInbox(teamName, workerName) {
    const inbox = inboxPath(teamName, workerName);
    const cursorFile = inboxCursorPath(teamName, workerName);
    if (existsSync(inbox)) {
        try { writeFileWithMode(inbox, ''); } catch { /* ignore */ }
    }
    if (existsSync(cursorFile)) {
        try { writeFileWithMode(cursorFile, JSON.stringify({ bytesRead: 0 })); } catch { /* ignore */ }
    }
}

// --- Shutdown / drain signals ---
export function writeShutdownSignal(teamName, workerName, requestId, reason) {
    const filePath = signalPath(teamName, workerName);
    ensureDir(filePath);
    writeFileWithMode(
        filePath,
        JSON.stringify({ requestId, reason, timestamp: new Date().toISOString() }, null, 2)
    );
}
export function checkShutdownSignal(teamName, workerName) {
    const filePath = signalPath(teamName, workerName);
    if (!existsSync(filePath)) return null;
    try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return null; }
}
export function deleteShutdownSignal(teamName, workerName) {
    const filePath = signalPath(teamName, workerName);
    if (existsSync(filePath)) { try { unlinkSync(filePath); } catch { /* ignore */ } }
}
export function writeDrainSignal(teamName, workerName, requestId, reason) {
    const filePath = drainSignalPath(teamName, workerName);
    ensureDir(filePath);
    writeFileWithMode(
        filePath,
        JSON.stringify({ requestId, reason, timestamp: new Date().toISOString() }, null, 2)
    );
}
export function checkDrainSignal(teamName, workerName) {
    const filePath = drainSignalPath(teamName, workerName);
    if (!existsSync(filePath)) return null;
    try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return null; }
}
export function deleteDrainSignal(teamName, workerName) {
    const filePath = drainSignalPath(teamName, workerName);
    if (existsSync(filePath)) { try { unlinkSync(filePath); } catch { /* ignore */ } }
}

export function cleanupWorkerFiles(teamName, workerName) {
    const files = [
        inboxPath(teamName, workerName),
        inboxCursorPath(teamName, workerName),
        outboxPath(teamName, workerName),
        signalPath(teamName, workerName),
        drainSignalPath(teamName, workerName),
    ];
    for (const f of files) {
        if (existsSync(f)) {
            try { unlinkSync(f); } catch { /* ignore */ }
        }
    }
}

/**
 * Cleanup per-cwd worker state introduced in schema v2:
 *   - mailbox/<worker>.json
 *   - archive/<worker>.jsonl
 *   - incoming-spool/<worker>/  (and every file inside it)
 *
 * Keeps the operator-visible audit trail (the team-state root jsonl events
 * log) intact. Failures are swallowed — cleanup is best-effort.
 */
export function cleanupWorkerCwdState(teamName, workerName, cwd) {
    if (!cwd) return;
    const targets = [
        absPath(cwd, TeamPaths.mailbox(teamName, workerName)),
        absPath(cwd, TeamPaths.archive(teamName, workerName)),
    ];
    for (const f of targets) {
        if (existsSync(f)) {
            try { unlinkSync(f); } catch { /* ignore */ }
        }
    }
    const spoolDir = absPath(cwd, TeamPaths.incomingSpoolDir(teamName, workerName));
    if (existsSync(spoolDir)) {
        try { rmSync(spoolDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}
