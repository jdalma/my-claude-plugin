import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { parseTmuxTarget } from '../model.js';

export function transcriptDirName(cwd) {
    return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return e.code === 'EPERM';
    }
}

function findTranscript(projectsDir, cwd, sessionId, exists) {
    const file = `${sessionId}.jsonl`;
    const primary = join(projectsDir, transcriptDirName(cwd), file);
    if (exists(primary)) return primary;
    let dirs;
    try {
        dirs = readdirSync(projectsDir);
    } catch {
        return null;
    }
    for (const d of dirs) {
        const p = join(projectsDir, d, file);
        if (exists(p)) return p;
    }
    return null;
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** One `~/.claude/sessions/<pid>.json` → record, or null if the process is dead. */
export function fromSessionJson(json, {
    isAlive: alive = isAlive,
    transcriptExists = existsSync,
    projectsDir = join(homedir(), '.claude', 'projects'),
} = {}) {
    if (!alive(json.pid)) return null;
    return {
        pid: json.pid,
        session_id: json.sessionId,
        cwd: json.cwd,
        started_at: iso(json.startedAt),
        proc_start: json.procStart ? iso(Date.parse(`${json.procStart} UTC`)) : null, // procStart is UTC
        status: json.status === 'busy' ? 'busy' : 'wait',
        since: iso(json.statusUpdatedAt ?? json.updatedAt),
        name: json.name,
        entrypoint: json.entrypoint,
        tmux: parseTmuxTarget(json.tmux),
        transcript: findTranscript(projectsDir, json.cwd, json.sessionId, transcriptExists),
    };
}

export function loadClaudeSessions({
    dir = join(homedir(), '.claude', 'sessions'),
    projectsDir = join(homedir(), '.claude', 'projects'),
} = {}) {
    let files;
    try {
        files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
        return [];
    }
    const out = [];
    for (const f of files) {
        try {
            const rec = fromSessionJson(JSON.parse(readFileSync(join(dir, f), 'utf-8')), { projectsDir });
            if (rec) out.push(rec);
        } catch {
            continue; // unparsable or unexpected shape (e.g. no cwd) — skip this file only
        }
    }
    return out;
}
