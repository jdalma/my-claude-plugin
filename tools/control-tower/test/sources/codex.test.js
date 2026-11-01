import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { classifyRollout, parseLsof, pickCandidates } from '../../src/sources/codex.js';
import { parsePs } from '../../src/sources/ps.js';

const fixture = (name) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

test('pickCandidates keeps the native TUI child, drops launcher/app-server/exec/helpers/self children', async () => {
    const rows = parsePs(await fixture('ps-codex.txt'));
    assert.deepEqual(pickCandidates(rows, 4000).map((r) => r.pid), [1001, 5000]);
    // without the self filter the helper under 4000 is a TUI too
    assert.deepEqual(pickCandidates(rows, 1).map((r) => r.pid), [1001, 4001, 5000]);
});

test('parseLsof groups cwd and file names by pid', () => {
    const text = [
        'p1001', 'fcwd', 'n/Users/me/proj', 'ftxt', 'n/bin/codex',
        'f25', 'n/Users/me/.codex/sessions/2026/10/29/rollout-2026-10-29T21-15-26-aaaa.jsonl',
        'p2000', 'fcwd', 'n/', 'f30', 'n/Users/me/.codex/sessions/2026/10/30/rollout-b.jsonl', '',
    ].join('\n');
    const m = parseLsof(text);
    assert.deepEqual(m.get(1001), {
        cwd: '/Users/me/proj',
        paths: ['/bin/codex', '/Users/me/.codex/sessions/2026/10/29/rollout-2026-10-29T21-15-26-aaaa.jsonl'],
    });
    assert.deepEqual(m.get(2000).paths, ['/Users/me/.codex/sessions/2026/10/30/rollout-b.jsonl']);
    assert.equal(parseLsof('').size, 0);
});

test('classifyRollout: complete after started is wait, since from that line', async () => {
    assert.deepEqual(classifyRollout(await fixture('codex-rollout-tail.jsonl')), {
        status: 'wait', since: '2026-10-29T12:17:05.500Z',
    });
});

test('classifyRollout: started after complete is busy', () => {
    const tail = [
        '{"timestamp":"2026-10-29T12:00:00.000Z","type":"event_msg","payload":{"type":"task_complete"}}',
        '{"timestamp":"2026-10-29T12:05:00.000Z","type":"event_msg","payload":{"type":"task_started"}}',
    ].join('\n');
    assert.deepEqual(classifyRollout(tail), { status: 'busy', since: '2026-10-29T12:05:00.000Z' });
});

test('classifyRollout: neither marker is unknown; a cut-off line gives since null', () => {
    assert.deepEqual(classifyRollout('{"timestamp":"x","type":"response_item"}\n'), { status: 'unknown', since: null });
    // tail cut mid-line before the timestamp: since is null, status still decided
    assert.deepEqual(classifyRollout('load":{"type":"task_started"}}'), { status: 'busy', since: null });
});

test('classifyRollout treats an aborted turn as finished', () => {
    const tail = [
        '{"timestamp":"T1","type":"event_msg","payload":{"type":"task_started"}}',
        '{"timestamp":"T2","type":"event_msg","payload":{"type":"turn_aborted"}}',
    ].join('\n');
    assert.deepEqual(classifyRollout(tail), { status: 'wait', since: 'T2' });
});
