/**
 * Unit tests for `my-team remove-worker` (mid-session worker removal).
 *
 * Same fixture pattern as add-worker.test.js: mkdtemp state_root +
 * MY_TEAM_STATE_ROOT_BASE so loadManifest resolves by team name. tmux-touching
 * functions (killPane / sendToWorker) are injected via the `deps` seam; the
 * manifest write runs for real and is asserted on disk.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runRemoveWorker } from '../../src/commands/remove-worker.js';

function setupTeam({ teamName = 't1', workers = ['alice', 'bob', 'carol'] } = {}) {
    const base = mkdtempSync(join(tmpdir(), 'my-team-test-'));
    const stateRoot = join(base, teamName);
    mkdirSync(stateRoot, { recursive: true });
    const manifest = {
        team_name: teamName,
        state_root: stateRoot,
        session_name: 'test-session',
        session_mode: 'split-pane',
        leader_pane: '%0',
        workers: workers.map((name, i) => ({
            name, pane_id: `%${i + 1}`, cwd: tmpdir(), agent_type: 'claude', overlay_path: '',
        })),
    };
    writeFileSync(join(stateRoot, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
    process.env.MY_TEAM_STATE_ROOT_BASE = base;
    return { base, stateRoot, teamName };
}

function cleanup(ctx) {
    delete process.env.MY_TEAM_STATE_ROOT_BASE;
    rmSync(ctx.base, { recursive: true, force: true });
}

const readManifest = (ctx) => JSON.parse(readFileSync(join(ctx.stateRoot, 'manifest.json'), 'utf-8'));

function spyDeps() {
    const killed = [];
    const notified = [];
    return {
        killed, notified,
        deps: {
            killPane: async (id) => { killed.push(id); },
            sendToWorker: async (_s, paneId, msg) => { notified.push([paneId, msg]); return true; },
        },
    };
}

test('removes the worker from the roster, kills its pane, notifies the rest', async () => {
    const ctx = setupTeam();
    const { killed, notified, deps } = spyDeps();
    try {
        const res = await runRemoveWorker({ team: 't1', name: 'bob' }, deps);
        assert.equal(res.pane_id, '%2');
        assert.deepEqual(readManifest(ctx).workers.map((w) => w.name), ['alice', 'carol']);
        assert.deepEqual(killed, ['%2']);
        assert.deepEqual(notified.map(([p]) => p), ['%1', '%3']);
        assert.match(notified[0][1], /'bob' has LEFT/);
    } finally { cleanup(ctx); }
});

test('rejects an unknown worker without touching the manifest or any pane', async () => {
    const ctx = setupTeam();
    const { killed, deps } = spyDeps();
    try {
        await assert.rejects(
            () => runRemoveWorker({ team: 't1', name: 'nobody' }, deps),
            /not in team/
        );
        assert.equal(readManifest(ctx).workers.length, 3);
        assert.deepEqual(killed, []);
    } finally { cleanup(ctx); }
});

test('never kills the leader pane', async () => {
    const ctx = setupTeam({ workers: ['alice'] });
    // Force the worker's pane_id to equal leader_pane (split-pane host edge case).
    const m = readManifest(ctx);
    m.workers[0].pane_id = m.leader_pane;
    writeFileSync(join(ctx.stateRoot, 'manifest.json'), JSON.stringify(m), 'utf-8');
    const { killed, deps } = spyDeps();
    try {
        await runRemoveWorker({ team: 't1', name: 'alice' }, deps);
        assert.deepEqual(killed, []);
        assert.equal(readManifest(ctx).workers.length, 0);
    } finally { cleanup(ctx); }
});

test('a failing departure notice does not undo the removal', async () => {
    const ctx = setupTeam();
    const { killed } = spyDeps();
    try {
        await runRemoveWorker({ team: 't1', name: 'bob' }, {
            killPane: async (id) => { killed.push(id); },
            sendToWorker: async () => { throw new Error('pane busy'); },
        });
        assert.deepEqual(readManifest(ctx).workers.map((w) => w.name), ['alice', 'carol']);
        assert.deepEqual(killed, ['%2']);
    } finally { cleanup(ctx); }
});
