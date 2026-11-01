import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planFocus, runFocus, TMUX_BIN } from '../src/focus.js';

const board = JSON.parse(readFileSync(new URL('./fixtures/board.json', import.meta.url), 'utf8'));
const clients = [{ session: 'my-team-demo-team-mvtepzfv', pid: 111, tty: '/dev/ttys001' }];

test('attached session: select window/pane then activate Ghostty', () => {
    assert.deepEqual(planFocus('pane:my-team-demo-team-mvtepzfv:%39', { board, clients }), {
        kind: 'attached',
        commands: [
            ['tmux', 'select-window', '-t', 'my-team-demo-team-mvtepzfv:@5'],
            ['tmux', 'select-pane', '-t', '%39'],
            ['open', '-a', 'Ghostty'],
        ],
    });
});

test('detached session: select window/pane then open a new Ghostty window attaching', () => {
    assert.deepEqual(planFocus('pane:my-team-detached-team-mvrtwe47:%29', { board, clients, tmuxBin: 'tmux' }), {
        kind: 'detached',
        commands: [
            ['tmux', 'select-window', '-t', 'my-team-detached-team-mvrtwe47:@4'],
            ['tmux', 'select-pane', '-t', '%29'],
            ['open', '-na', 'Ghostty.app', '--args', '-e', 'tmux', 'attach', '-t', 'my-team-detached-team-mvrtwe47'],
        ],
    });
});

test('outside tmux: open -a by TERM_PROGRAM', () => {
    assert.deepEqual(planFocus('pid:54524', { board, clients }), { kind: 'outside', commands: [['open', '-a', 'Ghostty']] });
    const b = structuredClone(board);
    b.loose[0].term_program = 'Apple_Terminal';
    assert.deepEqual(planFocus('pid:54524', { board: b, clients }), { kind: 'outside', commands: [['open', '-a', 'Terminal']] });
    b.loose[0].term_program = null;
    assert.deepEqual(planFocus('pid:54524', { board: b, clients }), { kind: 'none', commands: [] });
});

test('dead worker and unknown handle: none', () => {
    assert.deepEqual(planFocus('pane:my-team-demo-team-mvtepzfv:%41', { board, clients }), { kind: 'none', commands: [] });
    assert.deepEqual(planFocus('pane:nope:%1', { board, clients }), { kind: 'none', commands: [] });
    assert.deepEqual(planFocus('pid:1', { board, clients }), { kind: 'none', commands: [] });
});

test('runFocus executes commands in order', async () => {
    const calls = [];
    const plan = await runFocus('pane:my-team-demo-team-mvtepzfv:%39', { board, clients, exec: async (f, a) => calls.push([f, ...a]) });
    assert.deepEqual(calls, plan.commands);
});

test('runFocus stops at first failure and propagates stderr', async () => {
    const calls = [];
    const exec = async (f, a) => {
        calls.push([f, ...a]);
        if (a[0] === 'select-pane') throw Object.assign(new Error('exit 1'), { stderr: "can't find pane: %39\n" });
    };
    await assert.rejects(
        runFocus('pane:my-team-demo-team-mvtepzfv:%39', { board, clients, exec }),
        /can't find pane: %39/,
    );
    assert.equal(calls.length, 2);
});

test('focus.js never types into or ends a session', () => {
    const src = readFileSync(new URL('../src/focus.js', import.meta.url), 'utf8');
    assert.ok(!src.includes('send-keys'));
    assert.ok(!src.includes('kill-'));
});

test('TMUX_BIN resolves to an absolute path when tmux is on PATH', () => {
    assert.ok(TMUX_BIN === 'tmux' || TMUX_BIN.startsWith('/'));
});
