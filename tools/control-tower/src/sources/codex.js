import { execFile } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import { envOf, isDescendantOf, psSnapshot } from './ps.js';

const run = promisify(execFile);
const ROLLOUT = /\/sessions\/.*rollout-.*\.jsonl$/;
const TAIL_BYTES = 300_000;

const argv = (args) => args.split(/\s+/).filter(Boolean);
const isCodexBin = (r) => basename(argv(r.args)[0] ?? '') === 'codex';
const isAppServer = (r) => ` ${r.args}`.includes(' app-server');

/**
 * Interactive codex TUIs. argv[0] basename must be `codex`: the npm launcher is
 * `node …/bin/codex` (argv[0] = node) and its native child is `…/bin/codex`, so
 * this keeps exactly the child. app-server daemons, `codex exec` one-shots and
 * anything spawned under `selfPid` are dropped.
 */
export function pickCandidates(rows, selfPid) {
    return rows.filter((r) => {
        if (!isCodexBin(r) || isAppServer(r)) return false;
        // ponytail: first non-flag token; `codex -m x exec` slips through, add flag-value skipping if it shows up
        if (argv(r.args).slice(1).find((t) => !t.startsWith('-')) === 'exec') return false;
        return r.pid !== selfPid && !isDescendantOf(r.pid, selfPid, rows);
    });
}

/** `lsof -Fpfn` → Map<pid, { cwd, paths }>. */
export function parseLsof(text) {
    const out = new Map();
    let cur = null;
    let fd = null;
    for (const line of text.split('\n')) {
        const tag = line[0];
        const val = line.slice(1);
        if (tag === 'p') {
            cur = { cwd: null, paths: [] };
            out.set(+val, cur);
        } else if (tag === 'f') {
            fd = val;
        } else if (tag === 'n' && cur) {
            if (fd === 'cwd') cur.cwd = val;
            else cur.paths.push(val);
        }
    }
    return out;
}

/** Last task_started vs task_complete/turn_aborted in a rollout tail. */
export function classifyRollout(tail) {
    const started = tail.lastIndexOf('"type":"task_started"');
    // an interrupted turn (Esc) ends with turn_aborted instead of task_complete
    const complete = Math.max(tail.lastIndexOf('"type":"task_complete"'), tail.lastIndexOf('"type":"turn_aborted"'));
    if (started < 0 && complete < 0) return { status: 'unknown', since: null };
    const at = Math.max(started, complete);
    const end = tail.indexOf('\n', at);
    const line = tail.slice(tail.lastIndexOf('\n', at) + 1, end < 0 ? undefined : end);
    const ts = /"timestamp":"([^"]+)"/.exec(line);
    return { status: complete > started ? 'wait' : 'busy', since: ts ? ts[1] : null };
}

async function lsof(pids) {
    if (!pids.length) return new Map();
    try {
        const { stdout } = await run('lsof', ['-nP', '-w', '-Fpfn', '-p', pids.join(',')], { maxBuffer: 32 << 20, timeout: 8000 });
        return parseLsof(stdout);
    } catch (e) {
        // lsof exits 1 when any pid has vanished; the rest is still on stdout
        return parseLsof(e.stdout ?? '');
    }
}

function readHead(path) {
    let fd;
    try {
        fd = openSync(path, 'r');
        const chunks = [];
        const buf = Buffer.alloc(64 * 1024);
        for (let total = 0; total < 4 << 20;) {
            const n = readSync(fd, buf, 0, buf.length, total);
            if (!n) break;
            const nl = buf.subarray(0, n).indexOf(10);
            chunks.push(Buffer.from(buf.subarray(0, nl < 0 ? n : nl)));
            if (nl >= 0) break;
            total += n;
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')).payload ?? null;
    } catch {
        return null;
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

function readTail(path) {
    let fd;
    try {
        fd = openSync(path, 'r');
        const size = statSync(path).size;
        const len = Math.min(size, TAIL_BYTES);
        const buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, size - len);
        return buf.toString('utf8');
    } catch {
        return '';
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

const mtime = (p) => {
    try {
        return statSync(p).mtimeMs;
    } catch {
        return 0;
    }
};

function loadTitles(codexHome) {
    const titles = new Map();
    let text = '';
    try {
        text = readFileSync(join(codexHome, 'session_index.jsonl'), 'utf8');
    } catch {
        return titles;
    }
    for (const line of text.split('\n')) {
        try {
            const j = JSON.parse(line);
            if (j.id) titles.set(j.id, j.thread_name ?? ''); // later lines win
        } catch { /* blank or partial line */ }
    }
    return titles;
}

export async function loadCodexSessions({
    rows,
    codexHome = join(homedir(), '.codex'),
    selfPid = process.pid,
} = {}) {
    rows ??= await psSnapshot();
    const tuis = pickCandidates(rows, selfPid);
    if (!tuis.length) return [];
    const daemons = rows.filter((r) => isCodexBin(r) && isAppServer(r));
    const open = await lsof([...tuis, ...daemons].map((r) => r.pid));
    const rollouts = (pid) => (open.get(pid)?.paths ?? []).filter((p) => ROLLOUT.test(p));

    const metas = new Map();
    const meta = (p) => {
        if (!metas.has(p)) metas.set(p, readHead(p));
        return metas.get(p);
    };

    const own = new Map(tuis.map((t) => [t.pid, rollouts(t.pid)]));
    const claimed = new Set([...own.values()].filter((ps) => ps.length === 1).flat());
    const daemonPool = [...new Set(daemons.flatMap((d) => rollouts(d.pid)))].filter((p) => !claimed.has(p));

    const titles = loadTitles(codexHome);
    const out = [];
    for (const t of tuis) {
        const mine = own.get(t.pid);
        let cwd = open.get(t.pid)?.cwd ?? null;
        let transcript = null;
        if (mine.length === 1) {
            transcript = mine[0];
        } else {
            const pool = (mine.length ? mine : daemonPool).filter((p) => cwd && meta(p)?.cwd === cwd);
            transcript = pool.sort((a, b) => mtime(b) - mtime(a))[0] ?? null;
        }
        const m = transcript ? meta(transcript) : null;
        cwd ??= m?.cwd ?? '';
        const threadId = m?.id ?? null;
        const { status, since } = transcript ? classifyRollout(readTail(transcript)) : { status: 'unknown', since: null };
        out.push({
            pid: t.pid,
            ppid: t.ppid,
            cwd,
            started_at: m?.timestamp ?? t.lstart,
            transcript,
            thread_id: threadId,
            status,
            since,
            title: (threadId && titles.get(threadId)) || '',
            term_program: (await envOf(t.pid, ['TERM_PROGRAM'])).TERM_PROGRAM ?? null,
        });
    }
    return out;
}
