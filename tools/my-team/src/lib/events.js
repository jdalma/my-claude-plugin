/**
 * Append-only event log for worker-to-worker messages.
 *
 * Written by send-message API; read by `my-team monitor`.
 * Scope is intentionally narrow — only inter-worker messages, not task lifecycle.
 *
 * Format: one JSON object per line (JSON Lines).
 *   { ts, from, to, body }
 *
 * Failures are swallowed (try/catch + stderr warn) so mailbox writes are
 * never blocked by event log failures.
 */

import { appendFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';

export function eventsLogPath(stateRoot) {
    return join(stateRoot, 'events.jsonl');
}

export async function appendMessageEvent(stateRoot, { from, to, body }) {
    const entry = {
        ts: new Date().toISOString(),
        from,
        to,
        body,
    };
    const line = JSON.stringify(entry) + '\n';
    const path = eventsLogPath(stateRoot);
    try {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, line, 'utf-8');
    } catch (err) {
        process.stderr.write(`[my-team] events.jsonl append failed: ${err.message}\n`);
    }
}
