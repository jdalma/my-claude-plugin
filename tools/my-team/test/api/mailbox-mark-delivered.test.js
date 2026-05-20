/**
 * Unit tests for `my-team api mailbox-mark-delivered`.
 *
 * Strategy mirrors mailbox-list.test.js: tmp state root, manifest fixture,
 * direct handler invocation.
 *
 * Known limitation NOT tested here (deferred to Phase 2): concurrent
 * mark-delivered from two senders. The handler shares
 * tmux-comm.js:76-85's read-modify-write pattern; race fix is a separate PR.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runApiMailboxMarkDelivered } from '../../src/commands/api/mailbox-mark-delivered.js';

function setupTeam({ teamName = 't1', worker = 'alice', messages = [] } = {}) {
    const base = mkdtempSync(join(tmpdir(), 'my-team-test-'));
    const stateRoot = join(base, teamName);
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(join(stateRoot, 'mailbox'), { recursive: true });

    const manifest = {
        team_name: teamName,
        state_root: stateRoot,
        workers: [{ name: worker, pane_id: '%99', inbox_path: '' }],
    };
    writeFileSync(join(stateRoot, 'manifest.json'), JSON.stringify(manifest), 'utf-8');

    const mailboxFile = join(stateRoot, 'mailbox', `${worker}.json`);
    writeFileSync(mailboxFile, JSON.stringify({ messages }), 'utf-8');

    process.env.MY_TEAM_STATE_ROOT_BASE = base;
    return { base, stateRoot, teamName, worker, mailboxFile };
}

function cleanup(ctx) {
    delete process.env.MY_TEAM_STATE_ROOT_BASE;
    delete process.env.MY_TEAM_STATE_ROOT;
    rmSync(ctx.base, { recursive: true, force: true });
}

function readMailbox(ctx) {
    return JSON.parse(readFileSync(ctx.mailboxFile, 'utf-8'));
}

test('mark-delivered requires team_name', () => {
    assert.throws(() => runApiMailboxMarkDelivered({ worker: 'alice', message_id: '1' }), /team_name is required/);
});

test('mark-delivered requires worker', () => {
    assert.throws(() => runApiMailboxMarkDelivered({ team_name: 't1', message_id: '1' }), /worker is required/);
});

test('mark-delivered requires message_id', () => {
    assert.throws(() => runApiMailboxMarkDelivered({ team_name: 't1', worker: 'alice' }), /message_id is required/);
});

test('mark-delivered stamps consumed_at on target message', () => {
    const ctx = setupTeam({
        messages: [
            { message_id: 'm1', body: 'a', consumed_at: null },
            { message_id: 'm2', body: 'b', consumed_at: null },
        ],
    });
    try {
        const before = Date.now();
        const result = runApiMailboxMarkDelivered({
            team_name: ctx.teamName, worker: ctx.worker, message_id: 'm2',
        });
        const after = Date.now();
        assert.equal(result.ok, true);
        assert.equal(result.message_id, 'm2');

        const mbox = readMailbox(ctx);
        const m1 = mbox.messages.find((m) => m.message_id === 'm1');
        const m2 = mbox.messages.find((m) => m.message_id === 'm2');
        assert.equal(m1.consumed_at, null, 'm1 unchanged');
        assert.ok(typeof m2.consumed_at === 'string', 'm2 stamped with ISO string');
        const ts = Date.parse(m2.consumed_at);
        assert.ok(ts >= before && ts <= after, `consumed_at within window: ${m2.consumed_at}`);
    } finally {
        cleanup(ctx);
    }
});

test('mark-delivered is idempotent on already-consumed message', () => {
    const original = '2026-01-01T00:00:00.000Z';
    const ctx = setupTeam({
        messages: [{ message_id: 'm1', body: 'a', consumed_at: original }],
    });
    try {
        const result = runApiMailboxMarkDelivered({
            team_name: ctx.teamName, worker: ctx.worker, message_id: 'm1',
        });
        assert.equal(result.ok, true);
        assert.equal(result.already_consumed, true);
        const mbox = readMailbox(ctx);
        assert.equal(mbox.messages[0].consumed_at, original, 'consumed_at preserved on idempotent call');
    } finally {
        cleanup(ctx);
    }
});

test('mark-delivered throws on unknown message_id', () => {
    const ctx = setupTeam({
        messages: [{ message_id: 'm1', body: 'a', consumed_at: null }],
    });
    try {
        assert.throws(
            () => runApiMailboxMarkDelivered({
                team_name: ctx.teamName, worker: ctx.worker, message_id: 'unknown',
            }),
            /message_id 'unknown' not found/
        );
    } finally {
        cleanup(ctx);
    }
});

test('mark-delivered throws when mailbox file missing', () => {
    const ctx = setupTeam({ messages: [] });
    try {
        rmSync(ctx.mailboxFile);
        assert.throws(
            () => runApiMailboxMarkDelivered({
                team_name: ctx.teamName, worker: ctx.worker, message_id: 'm1',
            }),
            /mailbox not found/
        );
    } finally {
        cleanup(ctx);
    }
});
