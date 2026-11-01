import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseClients, parsePanes, PANE_FORMAT } from '../../src/sources/tmux.js';

test('PANE_FORMAT has the 8 fields and no pane_current_command', () => {
    assert.equal(PANE_FORMAT.split('\t').length, 8);
    assert.ok(!PANE_FORMAT.includes('pane_current_command'));
});

test('parsePanes parses host and worker panes', () => {
    const text = [
        'my-team-demo-mvtepzfv\t@5\t%40\t4101\t0\t\t✳ 워커 온보딩\t/Users/me/demo',
        'my-team-demo-mvtepzfv\t@5\t%42\t4102\t0\tapi-dev\t⠂ build the api\t/Users/me/demo/api',
        'scratch\t@9\t%77\t4200\t1\t\tzsh\t/tmp',
        '',
    ].join('\n');
    assert.deepEqual(parsePanes(text), [
        { session: 'my-team-demo-mvtepzfv', window: '@5', pane: '%40', pid: 4101, dead: false, worker_name: null, title: '✳ 워커 온보딩', cwd: '/Users/me/demo' },
        { session: 'my-team-demo-mvtepzfv', window: '@5', pane: '%42', pid: 4102, dead: false, worker_name: 'api-dev', title: '⠂ build the api', cwd: '/Users/me/demo/api' },
        { session: 'scratch', window: '@9', pane: '%77', pid: 4200, dead: true, worker_name: null, title: 'zsh', cwd: '/tmp' },
    ]);
});

test('parsePanes keeps a tab inside the title', () => {
    const [p] = parsePanes('s\t@1\t%1\t1\t0\tw\ta\tb\t/x\n');
    assert.equal(p.title, 'a\tb');
    assert.equal(p.cwd, '/x');
});

test('parsePanes / parseClients on empty output', () => {
    assert.deepEqual(parsePanes(''), []);
    assert.deepEqual(parseClients(''), []);
});

test('parseClients parses session, pid, tty', () => {
    assert.deepEqual(parseClients('my-team-demo-mvtepzfv\t5123\t/dev/ttys004\nscratch\t5200\t/dev/ttys007\n'), [
        { session: 'my-team-demo-mvtepzfv', pid: 5123, tty: '/dev/ttys004' },
        { session: 'scratch', pid: 5200, tty: '/dev/ttys007' },
    ]);
});
