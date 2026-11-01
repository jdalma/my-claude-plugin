/**
 * `/switch` implementation. Planning is pure; execution runs argv arrays with
 * execFile (no shell). Only moves focus: never types into or ends a session.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// A Ghostty window opened via `open` gets launchd's PATH (no /opt/homebrew/bin),
// so the attach command needs tmux's absolute path, resolved from our own PATH.
export const TMUX_BIN = (process.env.PATH ?? '').split(':').map((d) => join(d, 'tmux')).find((p) => existsSync(p)) ?? 'tmux';

const APPS = {
    ghostty: 'Ghostty',
    'iTerm.app': 'iTerm',
    Apple_Terminal: 'Terminal',
    WezTerm: 'WezTerm',
    vscode: 'Visual Studio Code',
    WarpTerminal: 'Warp',
};

const NONE = { kind: 'none', commands: [] };

/**
 * @param {string} handle
 * @param {{ board: import('./model.js').Board,
 *           clients: Array<{ session: string, pid: number, tty: string }>,
 *           ghosttyApp?: string }} opts
 * @returns {{ kind: 'attached'|'detached'|'outside'|'none', commands: string[][] }}
 */
export function planFocus(handle, { board, clients, ghosttyApp = 'Ghostty', tmuxBin = TMUX_BIN }) {
    const all = [...board.teams.flatMap((t) => t.workers), ...board.loose];
    const s = all.find((x) => x.handle === handle);
    if (!s) return NONE;

    if (handle.startsWith('pid:')) {
        const app = APPS[s.term_program];
        return app ? { kind: 'outside', commands: [['open', '-a', app]] } : NONE;
    }

    if (!s.tmux?.window) return NONE;
    const { session, window, pane } = s.tmux;
    const tmux = [
        ['tmux', 'select-window', '-t', `${session}:${window}`],
        ['tmux', 'select-pane', '-t', pane],
    ];
    if (clients.some((c) => c.session === session)) {
        return { kind: 'attached', commands: [...tmux, ['open', '-a', ghosttyApp]] };
    }
    return {
        kind: 'detached',
        commands: [...tmux, ['open', '-na', `${ghosttyApp}.app`, '--args', '-e', tmuxBin, 'attach', '-t', session]],
    };
}

const defaultExec = promisify(execFile);

/**
 * Run the plan in order; throws on the first failing command.
 * @param {string} handle
 * @param {Parameters<typeof planFocus>[1] & { exec?: (file: string, args: string[]) => Promise<unknown> }} deps
 */
export async function runFocus(handle, deps) {
    const plan = planFocus(handle, deps);
    const exec = deps.exec ?? defaultExec;
    for (const [file, ...args] of plan.commands) {
        try {
            await exec(file, args);
        } catch (err) {
            throw new Error(`${file} ${args.join(' ')} failed: ${(err.stderr || err.message || '').toString().trim()}`);
        }
    }
    return plan;
}
