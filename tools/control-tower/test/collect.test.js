import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { enrich, join } from '../src/collect.js';

const input = () => JSON.parse(readFileSync(new URL('./fixtures/collect-input.json', import.meta.url), 'utf-8'));
const AT = '2026-10-31T06:00:00.000Z';
const board = () => join({ ...input(), at: AT });
const worker = (b, name) => b.teams[0].workers.find((w) => w.worker_name === name);

const BOARD_KEYS = Object.keys(JSON.parse(readFileSync(new URL('./fixtures/board.json', import.meta.url), 'utf-8')).teams[0].workers[0]).sort();

test('every worker carries the full Worker shape', () => {
    for (const w of board().teams[0].workers) assert.deepEqual(Object.keys(w).sort(), BOARD_KEYS, w.worker_name);
    assert.equal(board().at, AT);
});

test('worker matched by claude pane', () => {
    const w = worker(board(), 'alpha');
    assert.equal(w.pid, 101);
    assert.equal(w.agent, 'claude');
    assert.equal(w.status, 'wait');
    assert.equal(w.my_turn, true);
    assert.equal(w.title, 'alpha title');
    assert.equal(w.transcript, '/Users/me/.claude/projects/a/s1.jsonl');
    assert.deepEqual(w.tmux, { session: 'my-team-demo-team-abc', window: '@1', pane: '%1' });
    assert.equal(w.handle, 'pane:my-team-demo-team-abc:%1');
});

test('worker matched by codex via ancestor shell pid', () => {
    const w = worker(board(), 'beta');
    assert.equal(w.pid, 202);
    assert.equal(w.agent, 'codex');
    assert.equal(w.status, 'busy');
    assert.equal(w.term_program, null);
    assert.deepEqual(w.tmux, { session: 'my-team-demo-team-abc', window: '@1', pane: '%2' });
    assert.ok(!board().loose.some((s) => s.pid === 202));
});

test('dead worker → pid 0, unknown, tmux null', () => {
    const w = worker(board(), 'gamma');
    assert.equal(w.pid, 0);
    assert.equal(w.status, 'unknown');
    assert.equal(w.tmux, null);
    assert.equal(w.my_turn, false);
    assert.equal(w.cwd, '/Users/me/gamma');
});

test('alive worker without a recognized process → unknown with tmux', () => {
    const w = worker(board(), 'delta');
    assert.equal(w.pid, 0);
    assert.equal(w.status, 'unknown');
    assert.deepEqual(w.tmux, { session: 'my-team-demo-team-abc', window: '@1', pane: '%4' });
    assert.equal(w.title, 'gemini');
    assert.equal(w.transcript, null);
});

test('my_turn false while spool > 0', () => {
    const w = worker(board(), 'epsilon');
    assert.equal(w.status, 'wait');
    assert.equal(w.my_turn, false);
    assert.equal(w.title, 'eps-name');
});

test('loose sessions: claude outside tmux → pid handle, claude in non-team tmux → pane handle', () => {
    const { loose } = board();
    assert.deepEqual(loose.map((s) => s.handle).sort(), ['pane:scratch:%9', 'pid:701']);
    const out = loose.find((s) => s.pid === 701);
    assert.equal(out.tmux, null);
    assert.equal(out.term_program, null);
    assert.equal(out.title, 'outside-name');
    assert.equal(out.my_turn, false);
    const scratch = loose.find((s) => s.pid === 901);
    assert.equal(scratch.title, 'scratch title');
    assert.equal(scratch.my_turn, true);
});

test('enrich fills last messages, permission, term_program', async () => {
    const calls = [];
    const b = await enrich(board(), {
        lastMessages: async (path, agent) => ({ last_user: `u:${agent}`, last_assistant: `a:${path}` }),
        capturePane: (pane) => (pane === '%5' ? 'Do you want to proceed?\n❯ 1. Yes\n  2. No' : ''),
        envOf: async (pid, keys) => {
            calls.push([pid, keys]);
            return { TERM_PROGRAM: 'ghostty' };
        },
    });
    const beta = worker(b, 'beta');
    assert.equal(beta.last_user, 'u:codex');
    assert.equal(beta.last_assistant, 'a:/Users/me/.codex/sessions/rollout-b.jsonl');
    assert.equal(worker(b, 'delta').last_user, '');
    const eps = worker(b, 'epsilon');
    assert.equal(eps.permission_prompt, true);
    assert.equal(eps.my_turn, true);
    assert.equal(worker(b, 'alpha').permission_prompt, false);
    assert.deepEqual(calls, [[701, ['TERM_PROGRAM']]]);
    assert.equal(b.loose.find((s) => s.pid === 701).term_program, 'ghostty');
});

test('a sessions file whose pid was reused (ps start ≠ procStart) is ignored', () => {
    const inp = input();
    const alpha = inp.claude.find((c) => c.pid === 101);
    alpha.proc_start = '2026-10-31T01:00:00.000Z';
    inp.rows.push({ pid: 101, ppid: 1, lstart: '2026-10-31T04:00:00.000Z' }); // a different, later process
    const w = join({ ...inp, at: AT }).teams[0].workers.find((x) => x.worker_name === 'alpha');
    assert.equal(w.pid, 0);
    assert.equal(w.status, 'unknown');
});

test('a worker my-team reports dead is never my_turn, even if a process still sits in its pane', async () => {
    const inp = input();
    const gamma = inp.teams[0].workers.find((x) => x.worker_name === 'gamma');
    inp.claude.push({ ...inp.claude.find((c) => c.pid === 101), pid: 303, status: 'wait',
        tmux: { session: 'my-team-demo-team-abc', window: '@1', pane: gamma.pane_id } });
    const b = join({ ...inp, at: AT });
    const w = b.teams[0].workers.find((x) => x.worker_name === 'gamma');
    assert.equal(w.pid, 303);
    assert.equal(w.my_turn, false);
    const e = await enrich(b, { capturePane: () => '', lastMessages: async () => ({ last_user: '', last_assistant: '' }), envOf: async () => ({}) });
    assert.equal(e.teams[0].workers.find((x) => x.worker_name === 'gamma').my_turn, false);
});
