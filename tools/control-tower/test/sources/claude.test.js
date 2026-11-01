import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fromSessionJson, loadClaudeSessions, transcriptDirName } from '../../src/sources/claude.js';

const SID = '065c71b5-0000-4000-8000-000000000001';
const base = {
    pid: 10005, sessionId: SID, cwd: '/Users/me/x', startedAt: 1793270113003,
    version: '2.1.312', entrypoint: 'cli', tmux: 'my-team-demo-mvtepzfv:@5.%42',
    name: 'x-77', status: 'idle', updatedAt: 1793428333000, statusUpdatedAt: 1793428333676,
    procStart: 'Thu Oct 29 10:35:09 2026',
};
const alive = () => true;

test('transcriptDirName replaces every non-alphanumeric char', () => {
    assert.equal(transcriptDirName('/Users/me/my_proj.v2'), '-Users-me-my-proj-v2');
});

test('fromSessionJson maps a tmux session', () => {
    const want = join('/p', '-Users-me-x', `${SID}.jsonl`);
    const rec = fromSessionJson(base, { isAlive: alive, transcriptExists: (p) => p === want, projectsDir: '/p' });
    assert.deepEqual(rec, {
        pid: 10005,
        session_id: SID,
        cwd: '/Users/me/x',
        started_at: new Date(1793270113003).toISOString(),
        proc_start: '2026-10-29T10:35:09.000Z',
        status: 'wait',
        since: new Date(1793428333676).toISOString(),
        name: 'x-77',
        entrypoint: 'cli',
        tmux: { session: 'my-team-demo-mvtepzfv', window: '@5', pane: '%42' },
        transcript: want,
    });
});

test('fromSessionJson: no tmux field, busy, updatedAt fallback, no transcript', () => {
    const { tmux, statusUpdatedAt, ...json } = { ...base, status: 'busy' };
    const rec = fromSessionJson(json, { isAlive: alive, transcriptExists: () => false, projectsDir: '/nonexistent' });
    assert.equal(rec.tmux, null);
    assert.equal(rec.status, 'busy');
    assert.equal(rec.since, new Date(1793428333000).toISOString());
    assert.equal(rec.transcript, null);
});

test('fromSessionJson returns null for a dead pid', () => {
    assert.equal(fromSessionJson(base, { isAlive: () => false }), null);
});

test('loadClaudeSessions: live only, skips bad json and .key, falls back to transcript search', () => {
    const root = mkdtempSync(join(tmpdir(), 'ct-claude-'));
    const dir = join(root, 'sessions');
    const projectsDir = join(root, 'projects');
    mkdirSync(dir);
    mkdirSync(join(projectsDir, 'moved-dir'), { recursive: true });
    writeFileSync(join(projectsDir, 'moved-dir', `${SID}.jsonl`), '');
    writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({ ...base, pid: process.pid }));
    writeFileSync(join(dir, '999999.json'), JSON.stringify({ ...base, pid: 999999 }));
    writeFileSync(join(dir, '1.json'), '{not json');
    writeFileSync(join(dir, `${process.pid}.abc.key`), 'x');

    const recs = loadClaudeSessions({ dir, projectsDir });
    assert.equal(recs.length, 1);
    assert.equal(recs[0].pid, process.pid);
    assert.equal(recs[0].transcript, join(projectsDir, 'moved-dir', `${SID}.jsonl`));
});

test('loadClaudeSessions on a missing dir returns []', () => {
    assert.deepEqual(loadClaudeSessions({ dir: '/nonexistent/sessions' }), []);
});
