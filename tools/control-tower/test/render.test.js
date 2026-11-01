import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderBoard, renderFragment, elapsed } from '../src/render.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/board.json', import.meta.url), 'utf8'));
const handles = (b) => [...b.teams.flatMap((t) => t.workers), ...b.loose].map((s) => s.handle);

test('fragment contains every handle', () => {
    const b = fixture();
    const html = renderFragment(b);
    for (const h of handles(b)) assert.ok(html.includes(`data-h="${h}"`), h);
});

test('untrusted text is escaped', () => {
    const b = fixture();
    const lead = b.teams[0].workers[0];
    lead.title = '✳ x <script>alert(1)</script>';
    lead.last_assistant = '"><img src=x onerror=alert(1)>';
    lead.state_file.reason = '<b>reason</b>';
    b.loose[0].title = '"><svg onload=alert(1)>';
    const html = renderFragment(b);
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<svg'));
    assert.ok(!html.includes('<b>'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('placeholders inside untrusted text are not substituted', () => {
    const b = fixture();
    b.teams[0].workers[0].last_assistant = '__TOKEN__ $& <!--BOARD-->';
    const html = renderBoard(b, { token: 'secret', intervalMs: 1000 });
    assert.ok(html.includes('__TOKEN__ $&amp; &lt;!--BOARD--&gt;'));
    assert.equal(html.split('secret').length, 2);
});

test('my_turn labels come first within a team, dead last', () => {
    const html = renderFragment(fixture());
    const team = html.split('<article')[1];
    const order = [...team.matchAll(/data-h="[^"]*:(%\d+)"/g)].map((m) => m[1]);
    // %38 my_turn, then %40 (since 05:50) before %39 (05:58), dead %41 last
    assert.deepEqual(order, ['%38', '%40', '%39', '%41']);
});

test('dead worker gets the dead class', () => {
    assert.match(renderFragment(fixture()), /class="chip dead" data-h="pane:my-team-demo-team-mvtepzfv:%41"/);
});

test('team summary comes from the orchestrator: reason and last reply, no pane title', () => {
    const team = renderFragment(fixture()).split('<article')[1].split('class="chips"')[0];
    assert.ok(!team.includes('brief fact-check aggregation'));
    assert.ok(team.includes('tasks A–J closed. 17 user questions pending'));
    assert.ok(team.includes('Summary written to research/2026-10-31-leader.md'));
    // other workers' messages are not spelled out in the panel
    assert.ok(!team.includes('Reading docs/adr/*.md'));
});

test('teams with my-turn workers are listed first', () => {
    const b = fixture();
    b.teams[0].workers.forEach((w) => { w.my_turn = false; });
    const html = renderFragment(b);
    assert.ok(html.indexOf('detached-team') < html.indexOf('demo-team'));
});

test('mail line only when a counter is non-zero', () => {
    const b = fixture();
    const html = renderFragment(b);
    assert.ok(html.includes('awaiting reply 2 (50m)'));
    const payments = html.split('<article')[2].split('class="summary')[0];
    assert.ok(!payments.includes('spool') && !payments.includes('awaiting'));
});

test('status line and my-turn total', () => {
    const html = renderFragment(fixture());
    assert.ok(html.includes('My turn · 20m'));   // tooltip
    assert.ok(html.includes('Working · 1m'));
    assert.ok(html.includes('class="chip perm"'));
    assert.ok(html.includes('<span class="t">20m</span>'));
    assert.ok(html.includes('data-my-turn="3"'));
    assert.equal(elapsed('2026-10-29T12:16:44Z', '2026-10-31T06:00:00Z'), '41h 43m');
    assert.equal(elapsed('2026-10-28T08:04:29Z', '2026-10-31T06:00:00Z'), '2d 21h');
});

test('summary falls back to the most recently active worker when the orchestrator has no reply', () => {
    const b = fixture();
    b.teams[0].workers[0].last_assistant = '';
    const team = renderFragment(b).split('<article')[1].split('class="chips"')[0];
    // backend-a (since 05:58) is more recent than frontend-b (05:50)
    assert.ok(team.includes('<span class="who">backend-a</span>Reading docs/adr/*.md'));
});

test('summary placeholder when nobody has reported', () => {
    const b = fixture();
    const t = b.teams[1];
    t.workers.forEach((w) => { w.last_assistant = ''; w.state_file = null; });
    assert.ok(renderFragment(b).includes('no report yet'));
});

test('teams are one column of team cards; loose sessions get Claude Code / Codex columns of their own cards', () => {
    const html = renderFragment(fixture());
    const cols = [...html.matchAll(/<section class="col[^"]*"><header><h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
    assert.deepEqual(cols, ['Teams', 'Claude Code', 'Codex']);
    assert.equal((html.match(/<article class="card team/g) || []).length, 2);
    // workers are labels, not cards
    assert.ok(!/class="card[^"]*" data-h="pane:/.test(html));
    // each loose session is its own clickable card with status and last words
    const codex = html.split('<h2>Codex</h2>')[1];
    assert.ok(codex.includes('class="card session mine" data-h="pid:51170"'));
    assert.ok(codex.includes('<div class="sub">career brief context handover</div>'));
    assert.ok(codex.includes('My turn · '));
    assert.ok(codex.includes('Context received. Nothing further unless you want edits.'));
});

test('a Codex column is omitted when there is no Codex session', () => {
    const b = fixture();
    b.loose = b.loose.filter((s) => s.agent !== 'codex');
    assert.ok(!renderFragment(b).includes('<h2>Codex</h2>'));
});
