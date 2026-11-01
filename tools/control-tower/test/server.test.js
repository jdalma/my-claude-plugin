import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { startServer } from '../src/server.js';

const board = JSON.parse(readFileSync(new URL('./fixtures/board.json', import.meta.url), 'utf8'));
const focused = [];
let server, url;

before(async () => {
    ({ server, url } = await startServer({
        port: 0, token: 'tok', getBoard: () => board, focus: async (h) => { focused.push(h); },
    }));
});
after(() => server.close());

const get = (path) => fetch(new URL(path, url));

test('/state.json round-trips the board', async () => {
    assert.deepEqual(await (await get('/state.json')).json(), board);
});

test('/switch rejects a missing or wrong token', async () => {
    const h = encodeURIComponent(board.loose[0].handle);
    assert.equal((await get(`/switch?h=${h}`)).status, 403);
    assert.equal((await get(`/switch?h=${h}&k=nope`)).status, 403);
    assert.equal(focused.length, 0);
});

test('/switch 404s an unknown handle', async () => {
    assert.equal((await get('/switch?h=pid:1&k=tok')).status, 404);
});

test('/switch focuses a known handle', async () => {
    const h = board.teams[0].workers[2].handle;
    const res = await get(`/switch?h=${encodeURIComponent(h)}&k=tok`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.deepEqual(focused, [h]);
});

test('/fragment is a subset of /', async () => {
    const page = await (await get('/')).text();
    const frag = await (await get('/fragment')).text();
    assert.ok(frag.length > 0 && page.includes(frag));
    assert.ok(page.includes("const TOKEN = 'tok'"));
});

test('unknown path and non-GET', async () => {
    assert.equal((await get('/nope')).status, 404);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
});

const statusWithHost = (path, host) => new Promise((resolve, reject) => {
    const u = new URL(path, url);
    http.get({ host: '127.0.0.1', port: u.port, path: u.pathname + u.search, headers: { host } }, (res) => {
        res.resume();
        resolve(res.statusCode);
    }).on('error', reject);
});

test('requests with a foreign Host header are rejected', async () => {
    const { port } = new URL(url);
    const sw = `/switch?h=${encodeURIComponent(board.loose[0].handle)}&k=tok`;
    assert.equal(await statusWithHost('/', 'evil.example:' + port), 403);
    assert.equal(await statusWithHost(sw, 'evil.example:' + port), 403);
    assert.equal(await statusWithHost('/', '127.0.0.1:1'), 403);
    assert.equal(await statusWithHost('/', `127.0.0.1:${port}`), 200);
    assert.equal(await statusWithHost('/', `localhost:${port}`), 200);
});
