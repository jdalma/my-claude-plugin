import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ENV = { ...process.env, LC_ALL: 'C' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// `  pid  ppid tty  Thu Oct 29 21:15:20 2026     <comm, 16 cols> <args>`
const LINE = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+\w{3} (\w{3}) +(\d{1,2}) (\d\d):(\d\d):(\d\d) (\d{4})\s+(.*)$/;
// ponytail: BSD ps pads/truncates a non-last `comm` column to 16 chars (MAXCOMLEN).
// comm is unreliable for matching (`/opt/homebrew/li`); match on args instead.
const COMM_WIDTH = 16;

function lstartIso(mon, day, h, m, s, y) {
    const month = MONTHS.indexOf(mon);
    if (month < 0) return null;
    return new Date(+y, month, +day, +h, +m, +s).toISOString();
}

/** Parse `ps -axo pid=,ppid=,tty=,lstart=,comm=,args=` output. */
export function parsePs(text) {
    const rows = [];
    for (const line of text.split('\n')) {
        const m = LINE.exec(line);
        if (!m) continue;
        const rest = m[10];
        rows.push({
            pid: +m[1],
            ppid: +m[2],
            tty: m[3],
            comm: rest.slice(0, COMM_WIDTH).trimEnd(),
            args: rest.slice(COMM_WIDTH + 1),
            lstart: lstartIso(m[4], m[5], m[6], m[7], m[8], m[9]),
        });
    }
    return rows;
}

export async function psSnapshot() {
    try {
        const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,tty=,lstart=,comm=,args='], { env: ENV, maxBuffer: 32 << 20, timeout: 5000 });
        return parsePs(stdout);
    } catch {
        return [];
    }
}

/**
 * Pick `keys` out of `ps -E -o command=` output. macOS appends the environment
 * after the args, space separated, so a value runs until the next ` NAME=`.
 * ponytail: a value that itself contains ` NAME=` gets cut short there.
 */
export function parseEnv(text, keys) {
    const out = {};
    const boundaries = [...text.matchAll(/\s([A-Za-z_][A-Za-z0-9_]*)=/g)];
    for (const key of keys) {
        // last occurrence: the env block follows the args, which may contain KEY=… too
        const i = boundaries.findLastIndex((b) => b[1] === key);
        if (i < 0) continue;
        const start = boundaries[i].index + boundaries[i][0].length;
        const end = i + 1 < boundaries.length ? boundaries[i + 1].index : text.length;
        out[key] = text.slice(start, end).replace(/\n$/, '');
    }
    return out;
}

export async function envOf(pid, keys) {
    try {
        const { stdout } = await run('ps', ['-E', '-o', 'command=', '-p', String(pid)], { env: ENV, maxBuffer: 8 << 20, timeout: 5000 });
        return parseEnv(stdout, keys);
    } catch {
        return {};
    }
}

/** Ancestor pids of `pid`, nearest first. Stops at 0/1 or after 40 hops. */
export function ancestors(pid, rows) {
    const parent = new Map(rows.map((r) => [r.pid, r.ppid]));
    const out = [];
    let cur = parent.get(pid);
    while (cur !== undefined && cur > 1 && out.length < 40) {
        out.push(cur);
        cur = parent.get(cur);
    }
    return out;
}

export function isDescendantOf(pid, ancestorPid, rows) {
    return ancestors(pid, rows).includes(ancestorPid);
}
