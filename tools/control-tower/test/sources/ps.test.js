import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ancestors, isDescendantOf, parseEnv, parsePs } from '../../src/sources/ps.js';

const text = await readFile(new URL('../fixtures/ps-codex.txt', import.meta.url), 'utf8');
const rows = parsePs(text);

test('parsePs splits fixed-width comm from args and converts lstart', () => {
    assert.equal(rows.length, 10);
    const child = rows.find((r) => r.pid === 1001);
    assert.equal(child.ppid, 1000);
    assert.equal(child.tty, 'ttys001');
    assert.equal(child.comm, '/opt/homebrew/li');
    assert.equal(child.args, '/opt/homebrew/lib/node_modules/@openai/codex/vendor/bin/codex --dangerously-bypass-approvals-and-sandbox');
    assert.equal(child.lstart, new Date(2026, 9, 29, 21, 15, 20).toISOString());
    // space-padded day of month
    assert.equal(rows.find((r) => r.pid === 2000).lstart, new Date(2026, 9, 2, 8, 0, 0).toISOString());
    assert.equal(rows.find((r) => r.pid === 900).comm, '-zsh');
});

test('parsePs skips garbage lines', () => {
    assert.deepEqual(parsePs('\nnot a ps line\n'), []);
});

test('ancestors walks nearest first and stops before launchd', () => {
    assert.deepEqual(ancestors(1002, rows), [1001, 1000, 900]);
    assert.deepEqual(ancestors(1, rows), []);
    assert.deepEqual(ancestors(99999, rows), []);
    assert.equal(isDescendantOf(1002, 1000, rows), true);
    assert.equal(isDescendantOf(1000, 1002, rows), false);
});

test('ancestors stops on a cycle after 40 hops', () => {
    const loop = [{ pid: 10, ppid: 11 }, { pid: 11, ppid: 10 }];
    assert.equal(ancestors(10, loop).length, 40);
});

test('parseEnv takes values up to the next NAME= and only requested keys', () => {
    const out = '/bin/codex --x FOO=args-not-env TERM_PROGRAM=ghostty FOO=a b c HOME=/Users/me PATH=/bin:/usr/bin\n';
    assert.deepEqual(parseEnv(out, ['TERM_PROGRAM', 'FOO', 'PATH', 'MISSING']), {
        TERM_PROGRAM: 'ghostty', FOO: 'a b c', PATH: '/bin:/usr/bin',
    });
});
