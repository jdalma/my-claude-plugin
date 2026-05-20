/**
 * Unit tests for `my-team api mailbox-list`.
 *
 * Strategy: each test gets an isolated `MY_TEAM_STATE_ROOT_BASE` under
 * os.tmpdir(), writes a minimal manifest + mailbox fixture, then invokes
 * `runApiMailboxList` directly. No tmux, no real CLI.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runApiMailboxList } from '../../src/commands/api/mailbox-list.js';

function setupTeam({ teamName = 't1', worker = 'alice', messages = null } = {}) {
    const base = mkdtempSync(join(tmpdir(), 'my-team-test-'));
    const stateRoot = join(base, teamName);
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(join(stateRoot, 'mailbox'), { recursive: true });

    const manifest = {
        team_name: teamName,
        state_root: stateRoot,
        workers: [
            { name: worker, pane_id: '%99', inbox_path: join(stateRoot, 'workers', worker, 'inbox.md') },
        ],
    };
    writeFileSync(join(stateRoot, 'manifest.json'), JSON.stringify(manifest), 'utf-8');

    if (messages !== null) {
        const mailboxFile = join(stateRoot, 'mailbox', `${worker}.json`);
        writeFileSync(mailboxFile, JSON.stringify({ messages }), 'utf-8');
    }

    process.env.MY_TEAM_STATE_ROOT_BASE = base;
    return { base, stateRoot, teamName, worker };
}

function cleanup(ctx) {
    delete process.env.MY_TEAM_STATE_ROOT_BASE;
    delete process.env.MY_TEAM_STATE_ROOT;
    rmSync(ctx.base, { recursive: true, force: true });
}

test('mailbox-list requires team_name', () => {
    assert.throws(() => runApiMailboxList({ worker: 'alice' }), /team_name is required/);
});

test('mailbox-list requires worker', () => {
    assert.throws(() => runApiMailboxList({ team_name: 't1' }), /worker is required/);
});

test('mailbox-list returns empty when mailbox file missing', () => {
    const ctx = setupTeam({ messages: null });
    try {
        const result = runApiMailboxList({ team_name: ctx.teamName, worker: ctx.worker });
        assert.equal(result.ok, true);
        assert.deepEqual(result.messages, []);
    } finally {
        cleanup(ctx);
    }
});

test('mailbox-list returns unread messages only by default', () => {
    const ctx = setupTeam({
        messages: [
            { message_id: '1', from_worker: 'bob', to_worker: 'alice', body: 'hi', created_at: 't', consumed_at: '2026-01-01T00:00:00Z' },
            { message_id: '2', from_worker: 'bob', to_worker: 'alice', body: 'still here', created_at: 't', consumed_at: null },
            { message_id: '3', from_worker: 'carol', to_worker: 'alice', body: 'new', created_at: 't' }, // no field
        ],
    });
    try {
        const result = runApiMailboxList({ team_name: ctx.teamName, worker: ctx.worker });
        assert.equal(result.messages.length, 2);
        assert.deepEqual(result.messages.map((m) => m.message_id), ['2', '3']);
    } finally {
        cleanup(ctx);
    }
});

test('mailbox-list returns all messages when unread_only=false', () => {
    const ctx = setupTeam({
        messages: [
            { message_id: '1', consumed_at: '2026-01-01T00:00:00Z' },
            { message_id: '2', consumed_at: null },
        ],
    });
    try {
        const result = runApiMailboxList({ team_name: ctx.teamName, worker: ctx.worker, unread_only: false });
        assert.equal(result.messages.length, 2);
    } finally {
        cleanup(ctx);
    }
});

test('mailbox-list throws on malformed mailbox JSON', () => {
    const ctx = setupTeam({ messages: null });
    try {
        const mailboxFile = join(ctx.stateRoot, 'mailbox', `${ctx.worker}.json`);
        writeFileSync(mailboxFile, '{ not valid json', 'utf-8');
        assert.throws(
            () => runApiMailboxList({ team_name: ctx.teamName, worker: ctx.worker }),
            /is not valid JSON/
        );
    } finally {
        cleanup(ctx);
    }
});

test('mailbox-list returns empty when messages field absent', () => {
    const ctx = setupTeam({ messages: null });
    try {
        const mailboxFile = join(ctx.stateRoot, 'mailbox', `${ctx.worker}.json`);
        writeFileSync(mailboxFile, JSON.stringify({ other: 'thing' }), 'utf-8');
        const result = runApiMailboxList({ team_name: ctx.teamName, worker: ctx.worker });
        assert.deepEqual(result.messages, []);
    } finally {
        cleanup(ctx);
    }
});
