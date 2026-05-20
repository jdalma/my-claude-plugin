/**
 * Unit tests for `my-team api send-message`.
 *
 * Focus: input validation + that `reply_to` (optional structural field for
 * async reply matching) survives into the recipient's mailbox.
 *
 * No tmux pane exists in the test env, so `sendTmuxTrigger` returns false
 * silently (tmux-comm.js try/catch) — the mailbox file write still happens.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runApiSendMessage } from '../../src/commands/api/send-message.js';

function setupTeam({ teamName = 't1', workers = ['alice', 'bob'] } = {}) {
    const base = mkdtempSync(join(tmpdir(), 'my-team-test-'));
    const stateRoot = join(base, teamName);
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(join(stateRoot, 'mailbox'), { recursive: true });

    const manifest = {
        team_name: teamName,
        state_root: stateRoot,
        workers: workers.map((name) => ({ name, pane_id: '%0', inbox_path: '' })),
    };
    writeFileSync(join(stateRoot, 'manifest.json'), JSON.stringify(manifest), 'utf-8');

    process.env.MY_TEAM_STATE_ROOT_BASE = base;
    return { base, stateRoot, teamName };
}

function cleanup(ctx) {
    delete process.env.MY_TEAM_STATE_ROOT_BASE;
    delete process.env.MY_TEAM_STATE_ROOT;
    rmSync(ctx.base, { recursive: true, force: true });
}

function readMailbox(ctx, worker) {
    const f = join(ctx.stateRoot, 'mailbox', `${worker}.json`);
    if (!existsSync(f)) return { messages: [] };
    return JSON.parse(readFileSync(f, 'utf-8'));
}

test('send-message requires team_name', async () => {
    await assert.rejects(
        () => runApiSendMessage({ from_worker: 'alice', to_worker: 'bob', body: 'hi' }),
        /team_name is required/
    );
});

test('send-message requires from_worker', async () => {
    await assert.rejects(
        () => runApiSendMessage({ team_name: 't1', to_worker: 'bob', body: 'hi' }),
        /from_worker is required/
    );
});

test('send-message requires to_worker', async () => {
    await assert.rejects(
        () => runApiSendMessage({ team_name: 't1', from_worker: 'alice', body: 'hi' }),
        /to_worker is required/
    );
});

test('send-message requires body', async () => {
    await assert.rejects(
        () => runApiSendMessage({ team_name: 't1', from_worker: 'alice', to_worker: 'bob' }),
        /body is required/
    );
});

test('send-message delivers message to recipient mailbox', async () => {
    const ctx = setupTeam();
    try {
        const result = await runApiSendMessage({
            team_name: ctx.teamName, from_worker: 'alice', to_worker: 'bob', body: 'hello',
        });
        assert.equal(result.ok, true);
        assert.equal(result.delivered_to, 'bob');
        const mbox = readMailbox(ctx, 'bob');
        assert.equal(mbox.messages.length, 1);
        assert.equal(mbox.messages[0].body, 'hello');
    } finally {
        cleanup(ctx);
    }
});

test('send-message defaults reply_to to null when not provided', async () => {
    const ctx = setupTeam();
    try {
        await runApiSendMessage({
            team_name: ctx.teamName, from_worker: 'alice', to_worker: 'bob', body: 'hello',
        });
        const mbox = readMailbox(ctx, 'bob');
        assert.equal(mbox.messages[0].reply_to, null);
    } finally {
        cleanup(ctx);
    }
});

test('send-message preserves reply_to when provided', async () => {
    const ctx = setupTeam();
    try {
        const result = await runApiSendMessage({
            team_name: ctx.teamName, from_worker: 'bob', to_worker: 'alice',
            body: 'here is the answer', reply_to: 'orig-msg-123',
        });
        assert.equal(result.ok, true);
        const mbox = readMailbox(ctx, 'alice');
        assert.equal(mbox.messages[0].reply_to, 'orig-msg-123');
    } finally {
        cleanup(ctx);
    }
});

test('send-message rejects unknown recipient', async () => {
    const ctx = setupTeam();
    try {
        await assert.rejects(
            () => runApiSendMessage({
                team_name: ctx.teamName, from_worker: 'alice', to_worker: 'ghost', body: 'hi',
            }),
            /not in team/
        );
    } finally {
        cleanup(ctx);
    }
});
