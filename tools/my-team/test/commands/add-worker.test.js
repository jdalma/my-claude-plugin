/**
 * Unit tests for `my-team add-worker` (mid-session worker add).
 *
 * Mirrors the send-message.test.js fixture pattern (mkdtemp state_root +
 * MY_TEAM_STATE_ROOT_BASE so loadManifest finds the manifest by team name),
 * but with a 5-field manifest worker shape {name, pane_id, cwd, agent_type,
 * overlay_path} — the shape start.js actually writes and add-worker appends to.
 *
 * No real tmux session exists in tests, so the tmux-touching functions
 * (isWorkerAlive / addWorkerPane / spawnWorkerInPane / waitForPaneReady /
 * sendToWorker / killPane) are injected via runAddWorker's `deps` seam. The
 * disk side (ensureWorkerStateDir / generateWorkerOverlay / writeFile /
 * atomicWriteJson / loadManifest) runs for real against the mkdtemp dir and is
 * asserted on disk.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';

import { runAddWorker } from '../../src/commands/add-worker.js';

/** A real, existing dir to use as a valid --cwd (the worker's cwd must exist). */
const VALID_CWD = tmpdir();

function setupTeam({ teamName = 't1', workers = ['alice', 'bob'] } = {}) {
    const base = mkdtempSync(join(tmpdir(), 'my-team-test-'));
    const stateRoot = join(base, teamName);
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(join(stateRoot, 'mailbox'), { recursive: true });

    const manifest = {
        team_name: teamName,
        state_root: stateRoot,
        session_name: 'test-session',
        session_mode: 'split-pane',
        leader_pane: '%0',
        workers: workers.map((name, i) => ({
            name,
            pane_id: `%${i + 1}`,
            cwd: VALID_CWD,
            agent_type: 'claude',
            overlay_path: '',
        })),
    };
    writeFileSync(join(stateRoot, 'manifest.json'), JSON.stringify(manifest), 'utf-8');

    process.env.MY_TEAM_STATE_ROOT_BASE = base;
    return { base, stateRoot, teamName };
}

function cleanup(ctx) {
    delete process.env.MY_TEAM_STATE_ROOT_BASE;
    delete process.env.MY_TEAM_STATE_ROOT;
    rmSync(ctx.base, { recursive: true, force: true });
}

function readManifest(ctx) {
    return JSON.parse(readFileSync(join(ctx.stateRoot, 'manifest.json'), 'utf-8'));
}

/** Default tmux stubs: everything succeeds, new pane id is %9. */
function okDeps(overrides = {}) {
    return {
        isWorkerAlive: async () => true,
        addWorkerPane: async () => ({ paneId: '%9' }),
        spawnWorkerInPane: async () => {},
        waitForPaneReady: async () => true,
        sendToWorker: async () => true,
        killPane: async () => {},
        ...overrides,
    };
}

const validOpts = (over = {}) => ({
    team: 't1', name: 'carol', cwd: VALID_CWD, agentType: 'claude', ...over,
});

// ── Step 1: required-flag gates (no manifest needed for the first ones) ──

test('rejects missing --team', async () => {
    await assert.rejects(
        () => runAddWorker({}, okDeps()),
        /team/i
    );
});

test('rejects missing --name', async () => {
    const ctx = setupTeam();
    try {
        await assert.rejects(() => runAddWorker({ team: 't1' }, okDeps()), /name/i);
    } finally { cleanup(ctx); }
});

test('rejects missing --cwd', async () => {
    const ctx = setupTeam();
    try {
        await assert.rejects(() => runAddWorker({ team: 't1', name: 'carol' }, okDeps()), /cwd/i);
    } finally { cleanup(ctx); }
});

test('rejects missing --agent-type', async () => {
    const ctx = setupTeam();
    try {
        await assert.rejects(
            () => runAddWorker({ team: 't1', name: 'carol', cwd: VALID_CWD }, okDeps()),
            /agent/i
        );
    } finally { cleanup(ctx); }
});

// ── Step 1: manifest / membership / cap gates ──

test('rejects when team manifest is missing (team not running)', async () => {
    // No setupTeam → no manifest on disk. Point base at an empty temp dir.
    const base = mkdtempSync(join(tmpdir(), 'my-team-test-'));
    process.env.MY_TEAM_STATE_ROOT_BASE = base;
    try {
        await assert.rejects(() => runAddWorker(validOpts(), okDeps()), /running|not found|manifest/i);
    } finally {
        delete process.env.MY_TEAM_STATE_ROOT_BASE;
        rmSync(base, { recursive: true, force: true });
    }
});

test('rejects duplicate worker name (raw)', async () => {
    const ctx = setupTeam({ workers: ['alice', 'bob'] });
    try {
        await assert.rejects(() => runAddWorker(validOpts({ name: 'alice' }), okDeps()), /duplicate|alice/i);
    } finally { cleanup(ctx); }
});

test('rejects sanitized name collision (50-char truncation)', async () => {
    // Two names that differ only past the 50-char sanitize cap collide.
    const prefix = 'a'.repeat(50);
    const existing = prefix + 'XXXX';
    const incoming = prefix + 'YYYY';
    const ctx = setupTeam({ workers: [existing] });
    try {
        await assert.rejects(
            () => runAddWorker(validOpts({ name: incoming }), okDeps()),
            /collision|saniti/i
        );
    } finally { cleanup(ctx); }
});

// ── --team accepts a tmux session name, not just the team name ──

test('resolves --team given a tmux session name (with :window suffix)', async () => {
    // The fixture session_name is 'test-session'; pass it (with a :0 suffix, as
    // a manifest stores it) as --team and confirm it resolves to team t1: the
    // worker is appended and the greeting embeds the t1 overlay path.
    const ctx = setupTeam({ workers: ['alice'] });
    const notices = [];
    try {
        const deps = okDeps({
            sendToWorker: async (_s, paneId, msg) => { notices.push({ paneId, msg }); return true; },
        });
        await runAddWorker(validOpts({ team: 'test-session:0' }), deps);
        const m = readManifest(ctx);
        assert.ok(m.workers.some((w) => w.name === 'carol'), 'worker appended via session-name resolve');
        // Canonical team name (t1) — not the session name — drives the overlay path.
        const expectedOverlay = join(ctx.stateRoot, 'workers', 'carol', 'AGENTS.md');
        assert.ok(notices[0]?.msg.includes(expectedOverlay), 'greeting uses canonical-team overlay path');
    } finally { cleanup(ctx); }
});

test('errors clearly when --team matches no team dir and no session name', async () => {
    const ctx = setupTeam({ workers: ['alice'] });
    try {
        await assert.rejects(
            () => runAddWorker(validOpts({ team: 'my-team-nope-deadbeef' }), okDeps()),
            /No team matched|running/i
        );
    } finally { cleanup(ctx); }
});

test('rejects when cap (10 workers) would be exceeded', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `w${i}`);
    const ctx = setupTeam({ workers: ten });
    try {
        await assert.rejects(() => runAddWorker(validOpts(), okDeps()), /10|cap|exceed/i);
    } finally { cleanup(ctx); }
});

test('rejects non-existent --cwd (via validateWorker)', async () => {
    const ctx = setupTeam();
    try {
        await assert.rejects(
            () => runAddWorker(validOpts({ cwd: '/no/such/path/at/all' }), okDeps()),
            /exist|director/i
        );
    } finally { cleanup(ctx); }
});

// ── Success + disk assertions ──

test('success: appends 5-field entry to manifest on disk', async () => {
    const ctx = setupTeam({ workers: ['alice'] });
    try {
        const res = await runAddWorker(validOpts(), okDeps());
        const m = readManifest(ctx);
        const carol = m.workers.find((w) => w.name === 'carol');
        assert.ok(carol, 'carol appended to manifest');
        assert.equal(carol.pane_id, '%9');
        assert.equal(carol.cwd, VALID_CWD);
        assert.equal(carol.agent_type, 'claude');
        assert.equal(typeof carol.overlay_path, 'string');
        assert.ok(carol.overlay_path.length > 0, 'overlay_path is set');
        // existing worker untouched
        assert.ok(m.workers.find((w) => w.name === 'alice'), 'alice still present');
        // return value
        assert.equal(res.name, 'carol');
        assert.equal(res.pane_id, '%9');
    } finally { cleanup(ctx); }
});

test('success: writes new worker AGENTS.md containing the new roster', async () => {
    const ctx = setupTeam({ workers: ['alice'] });
    try {
        await runAddWorker(validOpts(), okDeps());
        const overlay = join(ctx.stateRoot, 'workers', 'carol', 'AGENTS.md');
        assert.ok(existsSync(overlay), 'carol AGENTS.md written');
        const body = readFileSync(overlay, 'utf-8');
        assert.match(body, /carol/, 'roster lists self');
        assert.match(body, /alice/, 'roster lists existing peer');
    } finally { cleanup(ctx); }
});

test('does NOT rewrite existing workers\' AGENTS.md (decision §0 #1)', async () => {
    const ctx = setupTeam({ workers: ['alice'] });
    try {
        // pre-seed alice's overlay with a marker
        const aliceDir = join(ctx.stateRoot, 'workers', 'alice');
        mkdirSync(aliceDir, { recursive: true });
        const aliceOverlay = join(aliceDir, 'AGENTS.md');
        writeFileSync(aliceOverlay, 'MARKER-DO-NOT-TOUCH', 'utf-8');

        await runAddWorker(validOpts(), okDeps());

        assert.equal(readFileSync(aliceOverlay, 'utf-8'), 'MARKER-DO-NOT-TOUCH',
            'existing worker overlay must be unchanged');
    } finally { cleanup(ctx); }
});

test('rollback: spawn failure kills the new pane and does NOT append manifest', async () => {
    const ctx = setupTeam({ workers: ['alice'] });
    let killed = null;
    try {
        const deps = okDeps({
            spawnWorkerInPane: async () => { throw new Error('boom'); },
            killPane: async (id) => { killed = id; },
        });
        await assert.rejects(() => runAddWorker(validOpts(), deps), /boom/);
        assert.equal(killed, '%9', 'new pane was killed on rollback');
        const m = readManifest(ctx);
        assert.equal(m.workers.find((w) => w.name === 'carol'), undefined,
            'manifest must NOT contain carol after rollback');
    } finally { cleanup(ctx); }
});

// ── Name pattern boundary ──

test('rejects name with invalid characters (underscore)', async () => {
    const ctx = setupTeam();
    try {
        await assert.rejects(
            () => runAddWorker(validOpts({ name: 'alice_bob' }), okDeps()),
            /match|pattern|name/i
        );
    } finally { cleanup(ctx); }
});

// ── Liveness gate (also guards against the async-.find anchor trap) ──

test('rejects when no worker pane is alive (team session not live)', async () => {
    const ctx = setupTeam({ workers: ['alice', 'bob'] });
    try {
        const deps = okDeps({ isWorkerAlive: async () => false });
        await assert.rejects(() => runAddWorker(validOpts(), deps), /not live|session/i);
    } finally { cleanup(ctx); }
});

test('anchors on the first ALIVE worker when an earlier pane is dead', async () => {
    // workers[0]=alice is dead, workers[1]=bob is alive. add-worker must still
    // succeed, anchoring the split on bob's pane (%2), not the dead alice (%1).
    const ctx = setupTeam({ workers: ['alice', 'bob'] });
    let splitAnchor = null;
    try {
        const deps = okDeps({
            isWorkerAlive: async (paneId) => paneId !== '%1', // alice (%1) dead, bob (%2) alive
            addWorkerPane: async (_session, anchorPaneId) => { splitAnchor = anchorPaneId; return { paneId: '%9' }; },
        });
        await runAddWorker(validOpts(), deps);
        assert.equal(splitAnchor, '%2', 'split must anchor on the alive worker (bob), not the dead one');
    } finally { cleanup(ctx); }
});

// ── Join greeting: D announces itself; existing panes are NOT poked ──

test('triggers the new worker to greet peers via its startup notice (not in-pane pokes to existing workers)', async () => {
    const ctx = setupTeam({ workers: ['alice', 'bob'] });
    const notices = [];
    try {
        const deps = okDeps({
            sendToWorker: async (_session, paneId, msg) => { notices.push({ paneId, msg }); return true; },
        });
        await runAddWorker(validOpts(), deps);
        // Awareness is now D's job: the ONLY sendToWorker call targets the new
        // pane (%9) and tells D to greet its peers with expects_reply. The old
        // best-effort in-pane loop over existing panes (%1, %2) is gone.
        assert.equal(notices.length, 1, 'exactly one notice — to the new pane only');
        assert.equal(notices[0].paneId, '%9', 'notice targets the new worker pane');
        assert.match(notices[0].msg, /expects_reply/, 'D is told to request acknowledgement');
        assert.match(notices[0].msg, /OTHER worker/, 'D greets peers, not itself (avoids self-message throw)');
        // The notice MUST carry the absolute overlay path. The worker boots in
        // its own cwd with nothing wiring the overlay in, so a bare "your
        // AGENTS.md" leaves it unable to find its roster (the bug this fixes).
        const expectedOverlay = join(ctx.stateRoot, 'workers', 'carol', 'AGENTS.md');
        assert.ok(
            notices[0].msg.includes(expectedOverlay),
            `notice must embed the absolute overlay path (${expectedOverlay})`
        );
        const existingPanes = notices.filter((n) => n.paneId === '%1' || n.paneId === '%2');
        assert.equal(existingPanes.length, 0, 'existing worker panes are NOT poked in-pane anymore');
    } finally { cleanup(ctx); }
});

// ── Reload-ENOENT mid-operation abort (decision §0 #3) ──

test('aborts + kills pane if manifest disappears before the commit-point reload', async () => {
    const ctx = setupTeam({ workers: ['alice'] });
    let killed = null;
    try {
        const deps = okDeps({
            killPane: async (id) => { killed = id; },
            // simulate a concurrent shutdown: remove the manifest after the pane is split
            addWorkerPane: async () => {
                rmSync(join(ctx.stateRoot, 'manifest.json'), { force: true });
                return { paneId: '%9' };
            },
        });
        await assert.rejects(() => runAddWorker(validOpts(), deps), /shut down|mid-operation|manifest/i);
        assert.equal(killed, '%9', 'orphan pane killed on mid-operation abort');
    } finally { cleanup(ctx); }
});

// ── Tilde cwd expansion (validateWorker's expanded path must be used) ──

test('expands ~ in --cwd before storing in manifest and splitting the pane', async () => {
    const ctx = setupTeam({ workers: ['alice'] });
    let splitCwd = null;
    try {
        const deps = okDeps({
            addWorkerPane: async (_session, _anchor, worker) => { splitCwd = worker.cwd; return { paneId: '%9' }; },
        });
        // ~ always exists; validateWorker expands it to homedir()
        await runAddWorker(validOpts({ cwd: '~' }), deps);
        assert.equal(splitCwd, homedir(), 'pane split must use the expanded cwd, not "~"');
        const carol = readManifest(ctx).workers.find((w) => w.name === 'carol');
        assert.equal(carol.cwd, homedir(), 'manifest must store the expanded cwd, not "~"');
    } finally { cleanup(ctx); }
});

// ── launch_args forwarding (--launch-arg) ──

test('forwards launchArgs to the spawned worker CLI', async () => {
    const ctx = setupTeam({ workers: ['alice'] });
    let spawned = null;
    try {
        const deps = okDeps({
            spawnWorkerInPane: async (_session, _pane, config) => { spawned = config; },
        });
        await runAddWorker(validOpts({ launchArgs: ['--dangerously-skip-permissions'] }), deps);
        assert.deepEqual(spawned.launchArgs, ['--dangerously-skip-permissions'],
            'launch args must reach the spawned CLI');
    } finally { cleanup(ctx); }
});

test('defaults launchArgs to empty array when not provided', async () => {
    const ctx = setupTeam({ workers: ['alice'] });
    let spawned = null;
    try {
        const deps = okDeps({
            spawnWorkerInPane: async (_session, _pane, config) => { spawned = config; },
        });
        await runAddWorker(validOpts(), deps);
        assert.deepEqual(spawned.launchArgs, [], 'launchArgs defaults to []');
    } finally { cleanup(ctx); }
});
