import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    deriveMyTurn, permissionPromptIn, applyPermissionPrompt, extractText, lastMessages,
} from '../src/status.js';

const FIX = new URL('./fixtures/transcripts/', import.meta.url).pathname;

test('deriveMyTurn truth table', () => {
    assert.equal(deriveMyTurn({ status: 'wait' }), true);
    assert.equal(deriveMyTurn({ status: 'wait', spool: 0 }), true);
    assert.equal(deriveMyTurn({ status: 'wait', spool: 2 }), false);
    assert.equal(deriveMyTurn({ status: 'busy', spool: 0 }), false);
    assert.equal(deriveMyTurn({ status: 'unknown', spool: 0 }), false);
    assert.equal(deriveMyTurn({ status: 'busy', spool: 3, permission_prompt: true }), true);
    assert.equal(deriveMyTurn({ status: 'unknown', permission_prompt: true }), true);
});

const QUESTION_SCREEN = [
    '⏺ Bash(rm -rf build)',
    '',
    ' Bash command',
    '   rm -rf build',
    ' Do you want to proceed?',
    ' ❯ 1. Yes',
    '   2. Yes, and don\'t ask again for rm commands',
    '   3. No, and tell Claude what to do differently',
].join('\n');

const FOOTER_SCREEN = [
    ' Edit file src/app.js',
    ' ❯ 1. Yes',
    '   2. No',
    '',
    ' Esc to cancel',
].join('\n');

const TRUST_SCREEN = [
    ' Do you trust the files in this folder?',
    ' /tmp/example',
    ' ❯ 1. Yes, proceed',
    '   2. No, exit',
].join('\n');

test('permissionPromptIn detects tool and trust modals', () => {
    assert.equal(permissionPromptIn(QUESTION_SCREEN), true);
    assert.equal(permissionPromptIn(FOOTER_SCREEN), true);
    assert.equal(permissionPromptIn(TRUST_SCREEN), true);
    assert.equal(permissionPromptIn('❯ \n  ? for shortcuts'), false);
    assert.equal(permissionPromptIn('Do you want to proceed? I asked earlier.'), false);
    assert.equal(permissionPromptIn(''), false);
    assert.equal(permissionPromptIn(null), false);
});

test('applyPermissionPrompt forces wait + my_turn only when a modal is up', () => {
    const s = { handle: 'pid:1', status: 'busy', my_turn: false, permission_prompt: false };
    assert.deepEqual(applyPermissionPrompt(s, QUESTION_SCREEN),
        { ...s, status: 'wait', my_turn: true, permission_prompt: true });
    assert.deepEqual(applyPermissionPrompt(s, '❯ '), s);
    assert.deepEqual(applyPermissionPrompt({ ...s, permission_prompt: true }, ''), s);
});

test('extractText handles claude and codex shapes', () => {
    assert.deepEqual(extractText({ type: 'user', message: { content: 'hi' } }, 'claude'), { role: 'user', text: 'hi' });
    assert.deepEqual(extractText({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }] } }, 'claude'),
        { role: 'assistant', text: 'a\nb' });
    assert.equal(extractText({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }, 'claude'), null);
    assert.equal(extractText({ type: 'user', isMeta: true, message: { content: 'x' } }, 'claude'), null);
    assert.equal(extractText({ type: 'assistant', isSidechain: true, message: { content: 'x' } }, 'claude'), null);
    assert.equal(extractText({ type: 'user', message: { content: '<system-reminder>x' } }, 'claude'), null);
    assert.equal(extractText({ type: 'summary' }, 'claude'), null);

    const codex = (role, type, text) => ({ type: 'response_item', payload: { type: 'message', role, content: [{ type, text }] } });
    assert.deepEqual(extractText(codex('user', 'input_text', 'go'), 'codex'), { role: 'user', text: 'go' });
    assert.deepEqual(extractText(codex('assistant', 'output_text', 'done'), 'codex'), { role: 'assistant', text: 'done' });
    assert.equal(extractText(codex('user', 'input_text', '# AGENTS.md instructions'), 'codex'), null);
    assert.equal(extractText(codex('user', 'input_text', '<environment_context>'), 'codex'), null);
    assert.equal(extractText(codex('developer', 'input_text', 'sys'), 'codex'), null);
    assert.equal(extractText({ type: 'event_msg', payload: { type: 'agent_message', message: 'x' } }, 'codex'), null);
});

test('lastMessages reads the claude fixture', async () => {
    assert.deepEqual(await lastMessages(join(FIX, 'claude-basic.jsonl'), 'claude'), {
        last_user: 'Please add a health check endpoint.',
        last_assistant: 'Added GET /health returning 200.',
    });
});

test('lastMessages reads the codex fixture', async () => {
    assert.deepEqual(await lastMessages(join(FIX, 'codex-basic.jsonl'), 'codex'), {
        last_user: 'Rename the config loader.',
        last_assistant: 'Renamed loadConfig to readConfig.',
    });
});

test('lastMessages returns empty strings for missing/null paths', async () => {
    const empty = { last_user: '', last_assistant: '' };
    assert.deepEqual(await lastMessages(null, 'claude'), empty);
    assert.deepEqual(await lastMessages(join(FIX, 'nope.jsonl'), 'claude'), empty);
});

test('lastMessages reads only the 200KB tail and truncates to 300 chars', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ct-status-'));
    try {
        const rec = (type, text) => JSON.stringify({ type, isSidechain: false, message: { role: type, content: [{ type: 'text', text }] } });
        // old records that would win if the reader looked past the tail window
        const head = [rec('user', 'OLD user'), rec('assistant', 'OLD assistant')];
        const filler = Array.from({ length: 3000 }, (_, i) => JSON.stringify({ type: 'progress', i, pad: 'x'.repeat(100) }));
        const long = 'y'.repeat(1000);
        const lines = [...head, ...filler, rec('user', long), ...filler.slice(0, 10)];
        const path = join(dir, 'big.jsonl');
        await writeFile(path, lines.join('\n') + '\n');

        const got = await lastMessages(path, 'claude');
        assert.equal(got.last_user.length, 300);
        assert.ok(got.last_user.endsWith('…'));
        assert.equal(got.last_assistant, ''); // only beyond the 200KB window
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('trust prompt text quoted in scrollback is not a prompt', () => {
    const quoted = [
        "⏺ Write(test/status.test.js)",
        "  42 const TRUST_SCREEN = [",
        "  43   ' Do you trust the files in this folder?',",
        "  45   ' ❯ 1. Yes, proceed',",
        ...Array.from({ length: 20 }, (_, i) => `  line ${i}`),
        '❯ ',
        '  ? for shortcuts',
    ].join('\n');
    assert.equal(permissionPromptIn(quoted), false);
});
