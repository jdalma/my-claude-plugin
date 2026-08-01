/**
 * Adapted from oh-my-claude-sisyphus (MIT License)
 * https://github.com/Yeachan-Heo/oh-my-claudecode
 *
 * Source: dist/cli/tmux-utils.js
 * Modifications: none (pristine copy).
 */

import { exec, execFile, execFileSync, execSync, spawnSync } from 'child_process';
import { basename, isAbsolute, win32 as win32Path } from 'path';
import { promisify } from 'util';

export function tmuxEnv() {
    const { TMUX: _, ...env } = process.env;
    return env;
}

function resolveEnv(opts) {
    return opts?.stripTmux ? tmuxEnv() : process.env;
}

function isUnixLikeOnWindows() {
    return process.platform === 'win32' && !!(process.env.MSYSTEM || process.env.MINGW_PREFIX);
}

export function isNativeWindowsShell() {
    return process.platform === 'win32' && !isUnixLikeOnWindows();
}

function quoteForCmd(arg) {
    if (arg.length === 0) return '""';
    if (!/[\s"%^&|<>()]/.test(arg)) return arg;
    return `"${arg.replace(/(["%])/g, '$1$1')}"`;
}

function escapeForCmdSet(value) {
    return value.replace(/"/g, '""');
}

function resolveTmuxInvocation(args) {
    const resolvedBinary = resolveTmuxBinaryPath();
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedBinary)) {
        const comspec = process.env.COMSPEC || 'cmd.exe';
        const commandLine = [quoteForCmd(resolvedBinary), ...args.map(quoteForCmd)].join(' ');
        return { command: comspec, args: ['/d', '/s', '/c', commandLine] };
    }
    return { command: resolvedBinary, args };
}

export function tmuxExec(args, opts) {
    const { stripTmux: _, ...execOpts } = opts ?? {};
    const invocation = resolveTmuxInvocation(args);
    return execFileSync(invocation.command, invocation.args, {
        encoding: 'utf-8', ...execOpts, env: resolveEnv(opts),
    });
}

export async function tmuxExecAsync(args, opts) {
    const { stripTmux: _, timeout, ...rest } = opts ?? {};
    const invocation = resolveTmuxInvocation(args);
    return promisify(execFile)(invocation.command, invocation.args, {
        encoding: 'utf-8', env: resolveEnv(opts),
        ...(timeout !== undefined ? { timeout } : {}), ...rest,
    });
}

export function tmuxShell(command, opts) {
    const { stripTmux: _, ...execOpts } = opts ?? {};
    return execSync(`tmux ${command}`, { encoding: 'utf-8', ...execOpts, env: resolveEnv(opts) });
}

export async function tmuxShellAsync(command, opts) {
    const { stripTmux: _, timeout, ...rest } = opts ?? {};
    return promisify(exec)(`tmux ${command}`, {
        encoding: 'utf-8', env: resolveEnv(opts),
        ...(timeout !== undefined ? { timeout } : {}), ...rest,
    });
}

export function tmuxSpawn(args, opts) {
    const { stripTmux: _, ...spawnOpts } = opts ?? {};
    const invocation = resolveTmuxInvocation(args);
    return spawnSync(invocation.command, invocation.args, {
        encoding: 'utf-8', ...spawnOpts, env: resolveEnv(opts),
    });
}

export async function tmuxCmdAsync(args, opts) {
    if (args.some((a) => a.includes('#{'))) {
        const escaped = args.map((a) => "'" + a.replace(/'/g, "'\\''") + "'").join(' ');
        return tmuxShellAsync(escaped, opts);
    }
    return tmuxExecAsync(args, opts);
}

function resolveTmuxBinaryPath() {
    if (process.platform !== 'win32') return 'tmux';
    try {
        const result = spawnSync('where', ['tmux'], { timeout: 5000, encoding: 'utf8' });
        if (result.status !== 0) return 'tmux';
        const candidates = result.stdout?.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) ?? [];
        const first = candidates[0];
        if (first && (isAbsolute(first) || win32Path.isAbsolute(first))) return first;
    } catch {
        // fall through
    }
    return 'tmux';
}

export function isTmuxAvailable() {
    try {
        const resolvedBinary = resolveTmuxBinaryPath();
        if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedBinary)) {
            const comspec = process.env.COMSPEC || 'cmd.exe';
            const result = spawnSync(comspec, ['/d', '/s', '/c', `"${resolvedBinary}" -V`], { timeout: 5000 });
            return result.status === 0;
        }
        if (process.platform === 'win32') {
            const result = spawnSync(resolvedBinary, ['-V'], { timeout: 5000, shell: true });
            return result.status === 0;
        }
        tmuxExec(['-V'], { stripTmux: true, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

export function quoteShellArg(value) {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * Resolve a live pane from a tmux session name + worker name.
 *
 * Cross-team messaging addresses a recipient by the tmux session name the user
 * sees in `tmux ls`, not by team name. That is deliberate: a manifest is keyed
 * by team name and gets overwritten when the same team is started again, so two
 * concurrent sessions of one team share a single manifest and the older
 * session's pane ids are lost. tmux itself is the only source that always knows
 * which panes are actually alive, so we ask tmux.
 *
 * Each worker pane carries its name in the pane-scoped `@worker_name` option
 * (set by createTeamSession and re-asserted in start.js), so a single
 * `list-panes -a` gives us the full session/pane/worker mapping.
 *
 * Returns the pane id, or throws with the live alternatives listed — a dead or
 * mistyped session must fail loudly rather than silently spool a message that
 * nobody will ever read.
 */
export async function resolvePaneBySessionWorker(sessionName, workerName) {
    const target = sessionName.split(':')[0];
    let stdout;
    try {
        ({ stdout } = await tmuxCmdAsync([
            'list-panes', '-a', '-F', '#{session_name}\t#{pane_id}\t#{@worker_name}',
        ]));
    } catch (err) {
        throw new Error(`Cannot list tmux panes (is the tmux server running?): ${err.message}`);
    }

    const rows = stdout.split('\n')
        .map((line) => line.split('\t'))
        .filter((cols) => cols.length >= 2 && cols[0])
        .map(([session, paneId, worker]) => ({ session, paneId, worker: (worker ?? '').trim() }));

    const inSession = rows.filter((r) => r.session === target);
    if (inSession.length === 0) {
        const sessions = [...new Set(rows.map((r) => r.session))].filter((s) => s.startsWith('my-team-'));
        throw new Error(
            `tmux session '${sessionName}' not found or has no panes. ` +
            `Live my-team sessions: ${sessions.length ? sessions.join(', ') : '(none)'}.`
        );
    }

    const hit = inSession.find((r) => r.worker === workerName);
    if (!hit) {
        const names = inSession.map((r) => r.worker).filter(Boolean);
        throw new Error(
            `Worker '${workerName}' not found in tmux session '${sessionName}'. ` +
            `Workers in that session: ${names.length ? names.join(', ') : '(none — panes have no @worker_name)'}.`
        );
    }
    return hit.paneId;
}
