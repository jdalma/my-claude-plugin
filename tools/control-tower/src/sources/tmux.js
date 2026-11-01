import { execFileSync } from 'node:child_process';

// Read-only tmux access. This module must never call select-*, send-keys, kill-*.

export const PANE_FORMAT = [
    '#{session_name}', '#{window_id}', '#{pane_id}', '#{pane_pid}', '#{pane_dead}',
    '#{@worker_name}', '#{pane_title}', '#{pane_current_path}',
].join('\t');

export const CLIENT_FORMAT = '#{client_session}\t#{client_pid}\t#{client_tty}';

function lines(text) {
    return text.split('\n').filter((l) => l.length > 0);
}

export function parsePanes(text) {
    return lines(text).map((line) => {
        const f = line.split('\t');
        // title is the only free-text field; rejoin in case it contains a tab
        const [session, window, pane, pid, dead, worker] = f;
        return {
            session,
            window,
            pane,
            pid: Number(pid),
            dead: dead === '1',
            worker_name: worker || null,
            title: f.slice(6, -1).join('\t'),
            cwd: f[f.length - 1],
        };
    });
}

export function parseClients(text) {
    return lines(text).map((line) => {
        const [session, pid, tty] = line.split('\t');
        return { session, pid: Number(pid), tty };
    });
}

function tmux(args) {
    try {
        return execFileSync('tmux', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
    } catch {
        return ''; // no server / no tmux binary
    }
}

export function listPanes() {
    return parsePanes(tmux(['list-panes', '-a', '-F', PANE_FORMAT]));
}

export function listClients() {
    return parseClients(tmux(['list-clients', '-F', CLIENT_FORMAT]));
}

export function capturePane(pane, lines = 40) {
    return tmux(['capture-pane', '-p', '-S', `-${lines}`, '-t', pane]);
}
