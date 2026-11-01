import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { renderBoard, renderFragment } from './render.js';

const hasHandle = (board, h) =>
    board.teams.some((t) => t.workers.some((w) => w.handle === h)) || board.loose.some((s) => s.handle === h);

/**
 * @param {{ getBoard: () => import('./model.js').Board, focus: (handle: string) => Promise<void>,
 *           token: string, intervalMs?: number }} deps
 * @returns {http.Server} not listening; caller binds to 127.0.0.1
 */
export function createServer({ getBoard, focus, token, intervalMs = 5000 }) {
    return http.createServer(async (req, res) => {
        const send = (code, type, body) => {
            res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
            res.end(body);
        };
        const json = (code, obj) => send(code, 'application/json', JSON.stringify(obj));
        // DNS-rebinding guard: the page embeds the token, so only answer our own origin.
        const port = req.socket.server.address().port;
        if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
            return json(403, { ok: false, error: 'bad host' });
        }
        if (req.method !== 'GET') return json(405, { ok: false, error: 'method not allowed' });
        const url = new URL(req.url, 'http://127.0.0.1');
        try {
            switch (url.pathname) {
                case '/': return send(200, 'text/html; charset=utf-8', renderBoard(getBoard(), { token, intervalMs }));
                case '/fragment': return send(200, 'text/html; charset=utf-8', renderFragment(getBoard()));
                case '/state.json': return json(200, getBoard());
                case '/switch': {
                    const h = url.searchParams.get('h');
                    if (url.searchParams.get('k') !== token) return json(403, { ok: false, error: 'bad token' });
                    if (!h || !hasHandle(getBoard(), h)) return json(404, { ok: false, error: 'unknown handle' });
                    await focus(h);
                    return json(200, { ok: true });
                }
                default: return json(404, { ok: false, error: 'not found' });
            }
        } catch (err) {
            console.error(`control-tower: ${req.url}: ${err?.stack ?? err}`);
            return json(500, { ok: false, error: 'internal error' });
        }
    });
}

/** Listen on 127.0.0.1 only. `port: 0` picks a free port. */
export function startServer({ port = 47700, ...deps }) {
    const server = createServer(deps);
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
        });
    });
}

// Dev preview: `node src/server.js --fixture [port]`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && process.argv[2] === '--fixture') {
    const board = JSON.parse(readFileSync(new URL('../test/fixtures/board.json', import.meta.url), 'utf8'));
    const { url } = await startServer({
        port: Number(process.argv[3] ?? 47700),
        getBoard: () => board,
        focus: async (h) => console.log('focus', h),
        token: randomBytes(16).toString('hex'),
    });
    console.log(url);
}
