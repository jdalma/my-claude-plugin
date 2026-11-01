import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { handleOf, parseTmuxTarget, STATUSES } from '../src/model.js';

test('parseTmuxTarget parses the sessions-json tmux field', () => {
    assert.deepEqual(parseTmuxTarget('my-team-demo-team-mvtepzfv:@5.%42'), {
        session: 'my-team-demo-team-mvtepzfv', window: '@5', pane: '%42',
    });
    assert.equal(parseTmuxTarget(undefined), null);
    assert.equal(parseTmuxTarget('garbage'), null);
});

test('handleOf prefers the pane handle', () => {
    assert.equal(handleOf({ session: 's', window: '@1', pane: '%7' }, 123), 'pane:s:%7');
    assert.equal(handleOf(null, 123), 'pid:123');
});

test('fixture board conforms to the model vocabulary', async () => {
    const url = new URL('./fixtures/board.json', import.meta.url);
    const board = JSON.parse(await readFile(url, 'utf-8'));
    const sessions = [...board.teams.flatMap((t) => t.workers), ...board.loose];
    for (const s of sessions) {
        assert.ok(STATUSES.includes(s.status), `${s.handle}: status ${s.status}`);
        assert.equal(typeof s.my_turn, 'boolean');
    }
    for (const t of board.teams) {
        for (const w of t.workers) assert.equal(w.handle, `pane:${t.session_name}:${w.pane_id}`);
    }
    for (const s of board.loose) assert.equal(s.handle, handleOf(s.tmux, s.pid));
});
