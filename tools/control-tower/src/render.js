import { readFileSync } from 'node:fs';

const TEMPLATE = readFileSync(new URL('../public/board.html', import.meta.url), 'utf8');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** `12m`, `3h 5m`, `2d 4h`; '' when either side is missing. */
export function elapsed(fromIso, toIso) {
    if (!fromIso || !toIso) return '';
    const m = Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 60000));
    if (m < 60) return `${m}m`;
    if (m < 48 * 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

const basename = (p) => (p || '').replace(/\/+$/, '').split('/').pop() || p || '';

function statusLine(s, at) {
    const t = elapsed(s.since, at);
    const withTime = (label) => (t ? `${label} · ${t}` : label);
    if (s.alive === false) return ['dead', 'Dead'];
    if (s.permission_prompt) return ['perm', 'Permission prompt'];
    if (s.my_turn) return ['mine', withTime('My turn')];
    if (s.status === 'busy') return ['busy', withTime('Working')];
    if (s.status === 'wait') return ['idle', withTime('Idle')];
    return ['unknown', 'Unknown'];
}

/** my_turn first, then oldest `since`; dead workers last. */
export function sortCards(list) {
    const key = (s) => [s.alive === false ? 1 : 0, s.my_turn ? 0 : 1, s.since ? Date.parse(s.since) : Infinity];
    return [...list].sort((a, b) => {
        const ka = key(a), kb = key(b);
        return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
    });
}

/** Pane titles carry a status glyph (`✳ `, spinner) before Claude's own task summary. */
const cleanTitle = (t) => (t || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();

function mailOf(list, at) {
    const sum = (k) => list.reduce((n, s) => n + (s[k] || 0), 0);
    const out = [];
    if (sum('spool')) out.push(`spool ${sum('spool')}`);
    if (sum('inbox')) out.push(`inbox ${sum('inbox')}`);
    if (sum('sent_pending')) {
        const oldest = list.map((s) => s.oldest_pending_at).filter(Boolean).sort()[0];
        const t = elapsed(oldest, at);
        out.push(`awaiting reply ${sum('sent_pending')}${t ? ` (${t})` : ''}`);
    }
    return out.join(' · ');
}

/** One worker/session as a status label; details live in the tooltip. */
function chip(s, at) {
    const [cls, status] = statusLine(s, at);
    const name = s.worker_name || cleanTitle(s.title) || basename(s.cwd) || s.handle;
    const tip = [cleanTitle(s.title), status, basename(s.cwd), mailOf([s], at),
        s.state_file?.state && [s.state_file.state, s.state_file.reason].filter(Boolean).join(' — ')]
        .filter(Boolean).join('\n');
    const t = cls === 'dead' || cls === 'perm' ? status.toLowerCase() : elapsed(s.since, at);
    return `<button class="chip ${cls}" data-h="${esc(s.handle)}" title="${esc(tip)}">`
        + `<span class="dot"></span><span class="cname">${esc(name)}</span>`
        + (s.agent === 'codex' ? '<span class="agent">codex</span>' : '')
        + (t ? `<span class="t">${esc(t)}</span>` : '')
        + '</button>';
}

/**
 * What the team is doing, in its own words: the orchestrator's status.json
 * reason plus its last reply. Pane titles are left out — Claude names a pane
 * after the boot prompt, so they read "worker peer protocol" for days. When
 * the orchestrator has no reply, the most recently active worker speaks.
 */
function summary(team) {
    const lead = team.workers.find((w) => w.role === 'orchestrator') ?? team.workers[0];
    if (!lead) return '';
    const recent = [...team.workers].filter((w) => w.last_assistant)
        .sort((x, y) => Date.parse(y.since ?? 0) - Date.parse(x.since ?? 0))[0];
    const voice = lead.last_assistant ? lead : recent;
    const reason = lead.state_file?.reason;
    if (!reason && !voice) return '<div class="summary empty">no report yet</div>';
    return '<div class="summary">'
        + (reason ? `<div class="reason">${esc(reason)}</div>` : '')
        + (voice ? `<div class="msg"><span class="who">${esc(voice.worker_name)}</span>${esc(voice.last_assistant)}</div>` : '')
        + '</div>';
}

/** A my-team team: what it is doing, plus one status label per worker. */
function teamCard(t, at) {
    const mine = t.workers.filter((w) => w.my_turn).length;
    const meta = [`${t.workers.length} workers`, t.attached ? 'attached' : 'detached', elapsed(t.started_at, at), mailOf(t.workers, at)]
        .filter(Boolean).join(' · ');
    return `<article class="card team${mine ? ' mine' : ''}"><div class="head"><span class="name">${esc(t.name)}</span>`
        + (mine ? `<span class="mine-n">${mine} my turn</span>` : '')
        + `</div><div class="meta">${esc(meta)}</div>`
        + summary(t)
        + `<div class="chips">${sortCards(t.workers).map((s) => chip(s, at)).join('')}</div>`
        + '</article>';
}

/** A Claude Code / Codex terminal outside my-team: its status and its own last words. */
function sessionCard(s, at) {
    const [cls, status] = statusLine(s, at);
    const name = basename(s.cwd) || s.handle;
    const sub = cleanTitle(s.title);
    return `<button class="card session ${cls}" data-h="${esc(s.handle)}" title="${esc(s.cwd)}">`
        + `<div class="head"><span class="name">${esc(name)}</span></div>`
        // Claude's derived name is `<cwd basename>-<hex>`; only a real title (e.g. a Codex thread name) adds anything
        + (sub && !sub.startsWith(name) ? `<div class="sub">${esc(sub)}</div>` : '')
        + `<div class="status"><span class="dot"></span>${esc(status)}</div>`
        + (s.last_user ? `<div class="ask">${esc(s.last_user)}</div>` : '')
        + (s.last_assistant ? `<div class="msg">${esc(s.last_assistant)}</div>` : '')
        + '</button>';
}

function column(title, meta, cards, cls = '') {
    return `<section class="col ${cls}"><header><h2>${esc(title)}</h2><span class="meta">${esc(meta)}</span></header>${cards.join('')}</section>`;
}

const LEGEND = '<span class="legend"><span><i style="background:var(--mine)"></i>my turn</span>'
    + '<span><i style="background:var(--busy)"></i>working</span><span><i style="background:var(--perm)"></i>permission</span>'
    + '<span><i style="border:1px solid var(--mute)"></i>idle (mail pending)</span><span><i style="background:var(--mute)"></i>unknown</span></span>';

export const myTurnCount = (board) =>
    board.teams.reduce((n, t) => n + t.workers.filter((w) => w.my_turn).length, 0)
    + board.loose.filter((s) => s.my_turn).length;

/** Inner HTML of `<main>`, swapped in place by the client. */
export function renderFragment(board) {
    const at = board.at;
    const n = myTurnCount(board);
    const mineOf = (t) => t.workers.filter((w) => w.my_turn).length;
    const teams = [...board.teams].sort((x, y) => mineOf(y) - mineOf(x));
    const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
    const cols = [column('Teams', plural(teams.length, 'team'), teams.map((t) => teamCard(t, at)), 'teams')];
    for (const [agent, title] of [['claude', 'Claude Code'], ['codex', 'Codex']]) {
        const list = board.loose.filter((s) => s.agent === agent);
        if (!list.length) continue;
        const mine = list.filter((s) => s.my_turn).length;
        cols.push(column(title, `${plural(list.length, 'session')}${mine ? ` · ${mine} my turn` : ''}`, sortCards(list).map((s) => sessionCard(s, at))));
    }
    const time = at ? new Date(at).toLocaleTimeString('en-GB') : '';
    return `<div class="bar" data-my-turn="${n}"><strong>${n} my turn</strong><span>at ${esc(time)}</span>${LEGEND}</div>`
        + `<div class="cols">${cols.join('')}</div>`;
}

/** Full page. Placeholders are filled before the board so untrusted text can't inject them. */
export function renderBoard(board, { token = '', intervalMs = 5000 } = {}) {
    return TEMPLATE
        .replaceAll('__TOKEN__', JSON.stringify(String(token)).slice(1, -1))
        .replaceAll('__INTERVAL_MS__', String(Number(intervalMs)))
        .replace('<!--BOARD-->', () => renderFragment(board));
}
