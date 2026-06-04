/**
 * Unit tests for shutdown's state_root backup + cleanup (option 1B).
 *
 * Background: shutdown used to delete only manifest.json, so re-running `start`
 * with the same team_name inherited the prior run's events.jsonl / archive /
 * mailbox. shutdown now backs up the whole state_root to <state_root>.bak (one
 * generation) and removes the original. These tests cover the two helpers that
 * make that safe: isSafeToWipe (path guard) and backupAndRemoveStateRoot.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, chmodSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';

import { isSafeToWipe, backupAndRemoveStateRoot } from '../../src/commands/shutdown.js';

function makeStateRoot() {
    // mkdtemp gives a deep, unique path (e.g. /var/folders/.../my-team-XXXX),
    // which is what a real session state_root looks like — safe to wipe.
    const base = mkdtempSync(join(tmpdir(), 'my-team-shutdown-'));
    const stateRoot = join(base, 'demo-team');
    mkdirSync(join(stateRoot, 'archive'), { recursive: true });
    mkdirSync(join(stateRoot, 'mailbox'), { recursive: true });
    writeFileSync(join(stateRoot, 'manifest.json'), '{"team_name":"demo-team"}', 'utf-8');
    writeFileSync(join(stateRoot, 'events.jsonl'), '{"ts":"run-1"}\n', 'utf-8');
    writeFileSync(join(stateRoot, 'archive', 'alice.jsonl'), '{"m":1}\n', 'utf-8');
    return { base, stateRoot };
}

test('isSafeToWipe rejects dangerous / shallow paths', () => {
    assert.equal(isSafeToWipe(''), false);
    assert.equal(isSafeToWipe(null), false);
    assert.equal(isSafeToWipe(undefined), false);
    assert.equal(isSafeToWipe('/'), false);
    assert.equal(isSafeToWipe(homedir()), false);
    assert.equal(isSafeToWipe(homedir() + '/'), false); // trailing slash normalized
    assert.equal(isSafeToWipe('/tmp'), false);          // 1 segment — too shallow
    assert.equal(isSafeToWipe('/var/tmp'), false);      // 2 segments — too shallow
});

test('isSafeToWipe accepts a deep session state_root', () => {
    assert.equal(isSafeToWipe('/Users/me/.my-team/sessions/demo'), true);
    assert.equal(isSafeToWipe('/a/b/c'), true); // exactly 3 segments — the floor
});

test('backupAndRemoveStateRoot moves state_root to .bak and clears original', async () => {
    const { base, stateRoot } = makeStateRoot();
    try {
        const bak = `${stateRoot}.bak`;
        const res = await backupAndRemoveStateRoot(stateRoot);

        assert.equal(res.backedUpTo, bak);
        assert.equal(existsSync(stateRoot), false, 'original removed');
        assert.equal(existsSync(bak), true, 'backup exists');
        // Content preserved in the backup.
        assert.equal(readFileSync(join(bak, 'events.jsonl'), 'utf-8'), '{"ts":"run-1"}\n');
        assert.equal(existsSync(join(bak, 'archive', 'alice.jsonl')), true);
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});

test('backupAndRemoveStateRoot preserves state when the backup rename fails', async (t) => {
    // The user opted to always keep a backup, so a failed rename must NEVER
    // delete the original. Force rename to fail by making the parent dir
    // read-only (EACCES on rename). Skipped when running as root (perms ignored).
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
        t.skip('cannot test EACCES as root');
        return;
    }
    const { base, stateRoot } = makeStateRoot();
    const parent = join(base); // base is the parent of stateRoot
    try {
        chmodSync(parent, 0o500); // r-x: cannot create/rename entries inside
        const res = await backupAndRemoveStateRoot(stateRoot);

        assert.equal(res.backedUpTo, null, 'reports failure');
        assert.ok(res.error, 'carries the underlying error');
        assert.equal(existsSync(stateRoot), true, 'original state preserved (no data loss)');
    } finally {
        chmodSync(parent, 0o700); // restore so cleanup can remove it
        rmSync(base, { recursive: true, force: true });
    }
});

test('backupAndRemoveStateRoot keeps exactly one generation (old .bak replaced)', async () => {
    const { base, stateRoot } = makeStateRoot();
    try {
        const bak = `${stateRoot}.bak`;
        // Simulate a leftover .bak from a previous shutdown with stale content.
        mkdirSync(bak, { recursive: true });
        writeFileSync(join(bak, 'events.jsonl'), '{"ts":"OLD-stale"}\n', 'utf-8');

        await backupAndRemoveStateRoot(stateRoot);

        // The old .bak must be gone, replaced by the current run's state.
        assert.equal(readFileSync(join(bak, 'events.jsonl'), 'utf-8'), '{"ts":"run-1"}\n');
        assert.equal(existsSync(stateRoot), false);
    } finally {
        rmSync(base, { recursive: true, force: true });
    }
});
