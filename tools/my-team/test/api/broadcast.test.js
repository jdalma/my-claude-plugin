/**
 * Unit tests for queueBroadcastMessage (Phase C, CRITICAL #2).
 *
 * Broadcast intentionally forbids expects_reply=true: a single message_id
 * cannot be cleanly correlated across N recipients.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { queueBroadcastMessage } from '../../src/lib/tmux-comm.js';

function setupTeam({ teamName = 't1' } = {}) {
    const base = mkdtempSync(join(tmpdir(), 'my-team-test-'));
    const stateRoot = join(base, teamName);
    mkdirSync(stateRoot, { recursive: true });
    process.env.MY_TEAM_STATE_ROOT_BASE = base;
    process.env.MY_TEAM_STATE_ROOT = stateRoot;
    const parentDir = base;
    return { base, stateRoot, teamName, parentDir };
}

function cleanup(ctx) {
    delete process.env.MY_TEAM_STATE_ROOT_BASE;
    delete process.env.MY_TEAM_STATE_ROOT;
    rmSync(ctx.base, { recursive: true, force: true });
}

function readSpool(ctx, worker) {
    const dir = join(ctx.stateRoot, 'incoming-spool', worker);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((n) => n.endsWith('.json'))
        .map((n) => JSON.parse(readFileSync(join(dir, n), 'utf-8')));
}

test('broadcast drops a spool message to every worker', async () => {
    const ctx = setupTeam();
    try {
        const panes = { bob: '%0', carol: '%1' };
        const messages = await queueBroadcastMessage(ctx.teamName, 'alice', 'team standup at 10', panes, ctx.parentDir);
        assert.equal(messages.length, 2);
        assert.equal(messages[0].message_id, messages[1].message_id, 'broadcast shares one message_id');
        assert.equal(messages[0].expects_reply, false);

        const bobSpool = readSpool(ctx, 'bob');
        const carolSpool = readSpool(ctx, 'carol');
        assert.equal(bobSpool.length, 1);
        assert.equal(carolSpool.length, 1);
        assert.equal(bobSpool[0].body, 'team standup at 10');
        assert.equal(carolSpool[0].body, 'team standup at 10');
    } finally {
        cleanup(ctx);
    }
});

test('broadcast rejects expects_reply=true', async () => {
    const ctx = setupTeam();
    try {
        const panes = { bob: '%0' };
        await assert.rejects(
            () => queueBroadcastMessage(ctx.teamName, 'alice', 'q?', panes, ctx.parentDir, { expectsReply: true }),
            /Broadcast does not support expects_reply=true/
        );
    } finally {
        cleanup(ctx);
    }
});

test('broadcast excludes the sender from delivery even if present in panes', async () => {
    const ctx = setupTeam();
    try {
        // Sender is included in the roster — should NOT receive its own broadcast.
        const panes = { alice: '%0', bob: '%1', carol: '%2' };
        const messages = await queueBroadcastMessage(ctx.teamName, 'alice', 'team standup', panes, ctx.parentDir);
        assert.equal(messages.length, 2, 'alice excluded from her own broadcast');
        assert.deepEqual(
            messages.map((m) => m.to_worker).sort(),
            ['bob', 'carol']
        );
        const aliceSpool = readSpool(ctx, 'alice');
        assert.equal(aliceSpool.length, 0, 'sender spool untouched');
    } finally {
        cleanup(ctx);
    }
});
