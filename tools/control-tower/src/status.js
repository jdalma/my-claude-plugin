/**
 * Status derivation (docs/plan.md §5 steps 6-7). Pure except `lastMessages`,
 * which reads the tail of a transcript file.
 */
import { open } from 'node:fs/promises';

import { paneHasPermissionPrompt } from '../../my-team/src/lib/tmux-session.js';

const TAIL_BYTES = 200 * 1024;
const MAX_CHARS = 300;

/** P3: idle with an empty spool, or a modal waiting on the user. */
export function deriveMyTurn({ status, spool = 0, permission_prompt = false }) {
    return (status === 'wait' && spool === 0) || permission_prompt;
}

/**
 * Claude Code trust-folder dialog (startup, before any tool modal). Only the
 * last 14 non-empty lines count, like paneHasPermissionPrompt, so a transcript
 * that merely quotes the dialog text in scrollback is not a prompt; the menu
 * item must also start its own line.
 */
function hasTrustPrompt(captured) {
    const tail = captured.split('\n').map((l) => l.trim()).filter(Boolean).slice(-14);
    return tail.some((l) => /^Do you trust the (files in this folder|contents of this directory)\?/i.test(l)) &&
        tail.some((l) => /^[❯>]?\s*1\.\s*Yes,\s*(proceed|continue)/i.test(l));
}

export function permissionPromptIn(captured) {
    if (!captured) return false;
    return paneHasPermissionPrompt(captured) || hasTrustPrompt(captured);
}

export function applyPermissionPrompt(session, captured) {
    if (!permissionPromptIn(captured)) return { ...session, permission_prompt: false };
    return { ...session, permission_prompt: true, status: 'wait', my_turn: true };
}

function joinText(blocks, types) {
    if (typeof blocks === 'string') return blocks;
    if (!Array.isArray(blocks)) return '';
    return blocks.filter((b) => b && types.includes(b.type) && typeof b.text === 'string')
        .map((b) => b.text).join('\n');
}

/**
 * One transcript record → `{ role, text }`, or null when it carries no
 * user-visible text (tool calls/results, meta, sidechain, injected `<…>` blocks).
 */
export function extractText(record, agent) {
    let role;
    let text;
    if (agent === 'codex') {
        const p = record?.payload;
        if (record?.type !== 'response_item' || p?.type !== 'message') return null;
        role = p.role;
        text = joinText(p.content, ['input_text', 'output_text', 'text']).trim();
        if (text.startsWith('# AGENTS.md')) return null;
    } else {
        if (record?.type !== 'user' && record?.type !== 'assistant') return null;
        if (record.isMeta === true || record.isSidechain === true) return null;
        role = record.type;
        text = joinText(record.message?.content, ['text']).trim();
    }
    if (role !== 'user' && role !== 'assistant') return null;
    if (!text || text.startsWith('<')) return null;
    return { role, text };
}

function clip(text) {
    if (text.length <= MAX_CHARS) return text;
    const cut = /[\uD800-\uDBFF]/.test(text[MAX_CHARS - 2]) ? MAX_CHARS - 2 : MAX_CHARS - 1; // don't split a surrogate pair
    return text.slice(0, cut) + '…';
}

async function readTail(path) {
    const fh = await open(path, 'r');
    try {
        const { size } = await fh.stat();
        const start = Math.max(0, size - TAIL_BYTES);
        const buf = Buffer.alloc(size - start);
        await fh.read(buf, 0, buf.length, start);
        const lines = buf.toString('utf8').split('\n');
        if (start > 0) lines.shift(); // first line is partial
        return lines;
    } finally {
        await fh.close();
    }
}

export async function lastMessages(transcriptPath, agent) {
    const out = { last_user: '', last_assistant: '' };
    if (!transcriptPath) return out;
    let lines;
    try {
        lines = await readTail(transcriptPath);
    } catch {
        return out;
    }
    for (let i = lines.length - 1; i >= 0 && !(out.last_user && out.last_assistant); i--) {
        if (!lines[i]) continue;
        let record;
        try {
            record = JSON.parse(lines[i]);
        } catch {
            continue;
        }
        const msg = extractText(record, agent);
        if (!msg) continue;
        const key = msg.role === 'user' ? 'last_user' : 'last_assistant';
        if (!out[key]) out[key] = clip(msg.text);
    }
    return out;
}
