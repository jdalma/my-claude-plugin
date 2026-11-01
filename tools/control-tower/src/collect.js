/**
 * Collection loop (docs/plan.md §5): run every source once, join into a Board,
 * then enrich with transcript tails, permission modals and TERM_PROGRAM.
 */
import { handleOf } from './model.js';
import { applyPermissionPrompt, deriveMyTurn, lastMessages } from './status.js';
import { loadClaudeSessions } from './sources/claude.js';
import { loadCodexSessions } from './sources/codex.js';
import { loadTeams, toTeam } from './sources/myteam.js';
import { ancestors, envOf, psSnapshot } from './sources/ps.js';
import { capturePane, listClients, listPanes } from './sources/tmux.js';

const tmuxOf = (p) => ({ session: p.session, window: p.window, pane: p.pane });

/** Process-level Session fields in model order; last_* and permission are filled by enrich. */
function sessionFields({ handle, agent, proc, tmux, title, spool = 0, term_program = null }) {
    const status = proc ? proc.status : 'unknown';
    return {
        handle,
        agent,
        pid: proc?.pid ?? 0,
        cwd: proc?.cwd ?? '',
        started_at: proc?.started_at ?? null,
        status,
        my_turn: deriveMyTurn({ status, spool }),
        since: proc?.since ?? null,
        permission_prompt: false,
        title,
        tmux,
        transcript: proc?.transcript ?? null,
        last_user: '',
        last_assistant: '',
        term_program,
    };
}

/**
 * Pure join of raw source outputs into a Board (without last_* / permission).
 * @param {{ teams: object[], panes: object[], clients?: object[], claude: object[], codex: object[], rows: object[], at?: string }} input
 * @returns {import('./model.js').Board}
 */
export function join({ teams, panes, claude, codex, rows, at = new Date().toISOString() }) {
    const paneById = new Map(panes.map((p) => [p.pane, p]));
    const paneByPid = new Map(panes.map((p) => [p.pid, p]));
    const workerAt = new Map(); // `${session}\t${pane}` -> { team, worker }
    for (const team of teams) {
        for (const w of team.workers) workerAt.set(`${team.session_name}\t${w.pane_id}`, w);
    }
    const matched = new Map(); // worker -> { agent, proc, tmux }
    const loose = [];

    // A second process claiming an already-matched worker pane falls through to loose.
    const claim = (tmux, agent, proc) => {
        const w = tmux && workerAt.get(`${tmux.session}\t${tmux.pane}`);
        if (!w || matched.has(w)) return false;
        matched.set(w, { agent, proc, tmux });
        return true;
    };

    // A crashed Claude leaves its sessions/<pid>.json behind; if the pid was
    // reused, ps start time no longer matches procStart and the file is stale.
    const startOf = new Map(rows.map((r) => [r.pid, r.lstart]));
    const stale = (c) => c.proc_start && startOf.has(c.pid) &&
        Math.abs(Date.parse(startOf.get(c.pid)) - Date.parse(c.proc_start)) > 5000;

    for (const c of claude) {
        if (stale(c)) continue;
        const pane = c.tmux && paneById.get(c.tmux.pane);
        const tmux = c.tmux && { ...c.tmux, window: c.tmux.window || pane?.window };
        if (claim(tmux, 'claude', { ...c, title: pane?.title || c.name || '' })) continue;
        loose.push(sessionFields({ handle: handleOf(tmux, c.pid), agent: 'claude', proc: c, tmux, title: pane?.title || c.name || '' }));
    }

    for (const x of codex) {
        const shell = ancestors(x.pid, rows).find((pid) => paneByPid.has(pid));
        const pane = shell && paneByPid.get(shell);
        const tmux = pane ? tmuxOf(pane) : null;
        const title = pane?.title || x.title || '';
        if (claim(tmux, 'codex', { ...x, title })) continue;
        loose.push(sessionFields({
            handle: handleOf(tmux, x.pid), agent: 'codex', proc: x, tmux, title,
            term_program: tmux ? null : x.term_program ?? null,
        }));
    }

    return {
        at,
        teams: teams.map((team) => ({
            ...team,
            workers: team.workers.map((w) => {
                const m = matched.get(w);
                const pane = paneById.get(w.pane_id);
                const tmux = m?.tmux ?? (w.alive && pane ? tmuxOf(pane) : null);
                return {
                    ...sessionFields({
                        handle: w.handle,
                        agent: m?.agent ?? w.agent,
                        proc: m?.proc,
                        tmux,
                        title: m?.proc.title ?? pane?.title ?? '',
                        spool: w.spool,
                    }),
                    ...(w.alive ? {} : { my_turn: false }),
                    cwd: m?.proc.cwd || w.cwd || '',
                    worker_name: w.worker_name,
                    role: w.role,
                    description: w.description,
                    pane_id: w.pane_id,
                    alive: w.alive,
                    spool: w.spool,
                    inbox: w.inbox,
                    sent_pending: w.sent_pending,
                    oldest_pending_at: w.oldest_pending_at,
                    state_file: w.state_file,
                };
            }),
        })),
        loose,
    };
}

/** Fill last_* (transcript tail), permission_prompt (pane capture), and term_program (outside tmux). */
export async function enrich(board, { capturePane, lastMessages, envOf }) {
    const one = async (s, spool) => {
        const out = { ...s, ...(s.transcript ? await lastMessages(s.transcript, s.agent) : {}) };
        if (!s.tmux && s.term_program == null && s.pid) {
            out.term_program = (await envOf(s.pid, ['TERM_PROGRAM'])).TERM_PROGRAM ?? null;
        }
        if (!s.tmux) return out;
        const p = applyPermissionPrompt(out, capturePane(s.tmux.pane, 40));
        const turn = deriveMyTurn({ status: p.status, spool }) || p.permission_prompt;
        return { ...p, my_turn: s.alive !== false && turn };
    };
    const [teams, loose] = await Promise.all([
        Promise.all(board.teams.map(async (t) => ({ ...t, workers: await Promise.all(t.workers.map((w) => one(w, w.spool))) }))),
        Promise.all(board.loose.map((s) => one(s, 0))),
    ]);
    return { ...board, teams, loose };
}

const defaults = {
    psSnapshot, loadTeams, listPanes, listClients, loadClaudeSessions, loadCodexSessions,
    capturePane, lastMessages, envOf,
};

/** One full collection pass. A failing my-team degrades to no teams instead of killing the board. */
export async function collect(deps = defaults) {
    const d = { ...defaults, ...deps };
    const rows = await d.psSnapshot();
    const [rawTeams, codex] = await Promise.all([
        d.loadTeams().catch((err) => {
            console.error(`control-tower: ${err.message}`);
            return [];
        }),
        d.loadCodexSessions({ rows }),
    ]);
    const panes = d.listPanes();
    const clients = d.listClients();
    const teams = rawTeams.map((t) => toTeam(t, { clients }));
    const board = join({ teams, panes, claude: d.loadClaudeSessions(), codex, rows });
    return enrich(board, d);
}
