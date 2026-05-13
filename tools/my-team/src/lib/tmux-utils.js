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
