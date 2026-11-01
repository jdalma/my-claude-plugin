import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Read-only: only `my-team status --all --json` is ever run.

export const MY_TEAM_BIN = fileURLToPath(new URL('../../../my-team/bin/my-team', import.meta.url));

const execFileP = promisify(execFile);

function defaultExec(bin, args) {
    return execFileP(process.execPath, [bin, ...args], { timeout: 10_000, maxBuffer: 10 * 1024 * 1024 });
}

/**
 * Live teams from `my-team status --all --json`. Throws on failure; the caller decides.
 * @param {{ bin?: string, exec?: (bin: string, args: string[]) => Promise<{ stdout: string }> }} [opts]
 */
export async function loadTeams({ bin = MY_TEAM_BIN, exec = defaultExec } = {}) {
    let stdout;
    try {
        ({ stdout } = await exec(bin, ['status', '--all', '--json']));
    } catch (err) {
        throw new Error(`my-team status --all --json failed: ${(err.stderr || err.message || '').trim()}`);
    }
    try {
        return JSON.parse(stdout).teams.filter((t) => t.team_alive === true);
    } catch (err) {
        throw new Error(`my-team status --all --json: bad JSON: ${err.message}`);
    }
}

/**
 * my-team-owned part of a model Team. Workers are partial; collect.js adds the
 * process-level Session fields (pid, status, tmux, transcript, last_* ...).
 * @param {object} t   one entry of `status --all --json` `.teams`
 * @param {{ clients: { session: string }[] }} ctx
 */
export function toTeam(t, { clients }) {
    const session_name = t.session.replace(/:\d+$/, '');
    return {
        name: t.team_name,
        session_name,
        started_at: t.started_at ?? null,
        attached: clients.some((c) => c.session === session_name),
        workers: t.workers.map((w) => ({
            handle: `pane:${session_name}:${w.pane_id}`,
            worker_name: w.name,
            role: w.role ?? null,
            description: w.description ?? '',
            pane_id: w.pane_id,
            alive: w.alive,
            // ponytail: model only knows claude|codex; gemini/cursor etc. become 'claude'.
            // collect.js overwrites agent from the matched process anyway.
            agent: w.agent_type === 'codex' ? 'codex' : 'claude',
            cwd: w.cwd,
            spool: w.spool,
            inbox: w.unread,
            sent_pending: w.sent_pending,
            oldest_pending_at: w.oldest_pending_at,
            // updated_at is not in the status output
            state_file: w.state || w.reason ? { state: w.state ?? null, reason: w.reason ?? null, updated_at: null } : null,
        })),
    };
}
