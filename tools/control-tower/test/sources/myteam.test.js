import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadTeams, toTeam, MY_TEAM_BIN } from '../../src/sources/myteam.js';

const raw = readFileSync(new URL('../fixtures/myteam-status.json', import.meta.url), 'utf-8');
const status = JSON.parse(raw);
const clients = [{ session: 'my-team-demo-team-mvtepzfv', pid: 1, tty: '/dev/ttys001' }];

test('MY_TEAM_BIN points at the sibling my-team package', () => {
    assert.match(MY_TEAM_BIN, /tools\/my-team\/bin\/my-team$/);
});

test('loadTeams runs status --all --json and keeps only live teams', async () => {
    let call;
    const teams = await loadTeams({ bin: '/x/my-team', exec: async (bin, args) => { call = [bin, args]; return { stdout: raw }; } });
    assert.deepEqual(call, ['/x/my-team', ['status', '--all', '--json']]);
    assert.deepEqual(teams.map((t) => t.team_name), ['demo-team', 'other-team']);
});

test('loadTeams rejects with stderr when the command fails', async () => {
    const exec = async () => { throw Object.assign(new Error('Command failed'), { stderr: 'boom: no manifest\n' }); };
    await assert.rejects(loadTeams({ exec }), /boom: no manifest/);
});

test('loadTeams rejects on bad JSON', async () => {
    await assert.rejects(loadTeams({ exec: async () => ({ stdout: 'not json' }) }), /bad JSON/);
});

test('toTeam strips the window suffix and derives attached from clients', () => {
    const [demo, other] = status.teams.map((t) => toTeam(t, { clients }));
    assert.equal(demo.session_name, 'my-team-demo-team-mvtepzfv');
    assert.equal(demo.attached, true);
    assert.equal(other.attached, false);
    assert.equal(demo.started_at, '2026-10-31T01:00:00.000Z');
});

test('toTeam maps worker fields', () => {
    const { workers: [alpha, beta, gamma] } = toTeam(status.teams[0], { clients });
    assert.deepEqual(alpha, {
        handle: 'pane:my-team-demo-team-mvtepzfv:%38',
        worker_name: 'alpha',
        role: 'orchestrator',
        description: 'Demo orchestrator',
        pane_id: '%38',
        alive: true,
        agent: 'claude',
        cwd: '/Users/me/alpha',
        spool: 0,
        inbox: 0,
        sent_pending: 2,
        oldest_pending_at: '2026-10-31T05:10:00.000Z',
        state_file: { state: 'idle', reason: 'waiting for replies', updated_at: null },
    });
    // spool + unread, no state/reason
    assert.equal(beta.agent, 'codex');
    assert.equal(beta.spool, 1);
    assert.equal(beta.inbox, 1);
    assert.equal(beta.state_file, null);
    // dead worker, unknown agent type, missing role/description
    assert.equal(gamma.alive, false);
    assert.equal(gamma.agent, 'claude');
    assert.equal(gamma.role, null);
    assert.equal(gamma.description, '');
    assert.equal(gamma.handle, 'pane:my-team-demo-team-mvtepzfv:%40');
    assert.deepEqual(gamma.state_file, { state: 'done', reason: null, updated_at: null });
});
