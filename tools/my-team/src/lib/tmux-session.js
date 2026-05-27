/**
 * Adapted from oh-my-claude-sisyphus (MIT License)
 * https://github.com/Yeachan-Heo/oh-my-claudecode
 *
 * Source: dist/team/tmux-session.js
 * Modifications:
 *  - `createTeamSession(teamName, workers, cwd, options)` takes a `workers`
 *    array (each with `name` and `cwd`) instead of a single `workerCount`.
 *    Each worker pane is spawned with `tmux split-window -c <worker.cwd>`.
 *    This is the core change that lifts OMC's single-cwd constraint.
 *  - `sanitizeName` moved to `./team-name.js` (re-exported here for back-compat).
 *  - Pruned OMC-internal helpers we don't need (worktree assertions, etc.).
 */

import { existsSync } from 'fs';
import { join, basename, isAbsolute, win32 } from 'path';
import fs from 'fs/promises';

import { validateTeamName, sanitizeName } from './team-name.js';
import { tmuxExec, tmuxExecAsync, tmuxShell, tmuxCmdAsync } from './tmux-utils.js';

export { sanitizeName };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TMUX_SESSION_PREFIX = 'my-team';

export function detectTeamMultiplexerContext(env = process.env) {
    if (env.TMUX) return 'tmux';
    if (env.CMUX_SURFACE_ID) return 'cmux';
    return 'none';
}

export function isUnixLikeOnWindows() {
    return process.platform === 'win32' && !!(process.env.MSYSTEM || process.env.MINGW_PREFIX);
}

/**
 * Apply a grid (tiled) layout to the team window. tmux auto-arranges panes
 * into roughly equal rows × cols (e.g. 4 panes → 2x2, 6 → 2x3 or 3x2).
 *
 * Also enables pane-border-status so each pane's title (set via
 * `select-pane -T <name>`) is shown on the top border line.
 */
export async function applyTeamLayout(teamTarget) {
    try {
        await tmuxExecAsync(['select-layout', '-t', teamTarget, 'tiled']);
    } catch { /* ignore */ }
    // Show pane titles on the top border of every pane in this window.
    try {
        await tmuxExecAsync(['set-window-option', '-t', teamTarget, 'pane-border-status', 'top']);
    } catch { /* ignore */ }
    // Render @worker_name (set per pane) when present, otherwise fall back to
    // pane_title (used for the leader pane). Worker CLIs continuously emit OSC
    // title sequences that overwrite pane_title — `allow-rename off` only
    // protects window names, not pane titles, so we route worker labels
    // through a pane-scoped user option that the CLI cannot touch.
    try {
        await tmuxExecAsync([
            'set-window-option', '-t', teamTarget,
            'pane-border-format', ' #{?@worker_name,#{@worker_name},#{pane_title}} ',
        ]);
    } catch { /* ignore */ }
    // allow-rename / automatic-rename still useful to keep window name stable.
    try {
        await tmuxExecAsync(['set-window-option', '-t', teamTarget, 'allow-rename', 'off']);
    } catch { /* ignore */ }
    try {
        await tmuxExecAsync(['set-window-option', '-t', teamTarget, 'automatic-rename', 'off']);
    } catch { /* ignore */ }
}

const SUPPORTED_POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'ksh']);
export function getDefaultShell() {
    if (process.platform === 'win32' && !isUnixLikeOnWindows()) {
        return process.env.COMSPEC || 'cmd.exe';
    }
    const shell = process.env.SHELL || '/bin/bash';
    const name = basename(shell.replace(/\\/g, '/')).replace(/\.(exe|cmd|bat)$/i, '');
    if (!SUPPORTED_POSIX_SHELLS.has(name)) return '/bin/sh';
    return shell;
}

function shellEscape(value) {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function assertSafeEnvKey(key) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Invalid environment key: "${key}"`);
    }
}

const DANGEROUS_LAUNCH_BINARY_CHARS = /[;&|`$()<>\n\r\t\0]/;
function isAbsoluteLaunchBinaryPath(value) {
    return isAbsolute(value) || win32.isAbsolute(value);
}

function assertSafeLaunchBinary(launchBinary) {
    if (launchBinary.trim().length === 0) {
        throw new Error('Invalid launchBinary: value cannot be empty');
    }
    if (launchBinary !== launchBinary.trim()) {
        throw new Error('Invalid launchBinary: value cannot have leading/trailing whitespace');
    }
    if (DANGEROUS_LAUNCH_BINARY_CHARS.test(launchBinary)) {
        throw new Error('Invalid launchBinary: contains dangerous shell metacharacters');
    }
    if (/\s/.test(launchBinary) && !isAbsoluteLaunchBinaryPath(launchBinary)) {
        throw new Error('Invalid launchBinary: paths with spaces must be absolute');
    }
}

/**
 * Build a safe shell command for spawning a worker CLI in a tmux pane.
 * env vars are escaped, login shell sources rc file, then `exec` worker.
 */
export function buildWorkerStartCommand(config) {
    const shell = getDefaultShell();
    const shouldSourceRc = process.env.MY_TEAM_NO_RC !== '1' && process.env.OMC_TEAM_NO_RC !== '1';

    if (!config.launchBinary) {
        throw new Error('Missing worker launch command. Provide launchBinary.');
    }
    assertSafeLaunchBinary(config.launchBinary);
    const launchWords = [config.launchBinary, ...(config.launchArgs ?? [])];

    const envAssignments = Object.entries(config.envVars ?? {}).map(([key, value]) => {
        assertSafeEnvKey(key);
        return `${key}=${shellEscape(value)}`;
    });

    const shellName = basename(shell.replace(/\\/g, '/')).replace(/\.(exe|cmd|bat)$/i, '');
    const isFish = shellName === 'fish';
    const execArgsCommand = isFish ? 'exec $argv' : 'exec "$@"';

    let rcFile = '';
    if (process.env.HOME) {
        rcFile = isFish
            ? `${process.env.HOME}/.config/fish/config.fish`
            : `${process.env.HOME}/.${shellName}rc`;
    }

    let script;
    if (isFish) {
        script = shouldSourceRc && rcFile
            ? `test -f ${shellEscape(rcFile)}; and source ${shellEscape(rcFile)}; ${execArgsCommand}`
            : execArgsCommand;
    } else {
        script = shouldSourceRc && rcFile
            ? `[ -f ${shellEscape(rcFile)} ] && . ${shellEscape(rcFile)}; ${execArgsCommand}`
            : execArgsCommand;
    }
    const shellFlags = isFish ? ['-l', '-c'] : ['-lc'];

    return [
        shellEscape('env'),
        ...envAssignments,
        ...[shell, ...shellFlags, script, '--', ...launchWords].map(shellEscape),
    ].join(' ');
}

export function validateTmux(hasTmuxContext = false) {
    if (hasTmuxContext) return;
    try {
        tmuxShell('-V', { stripTmux: true, timeout: 5000, stdio: 'pipe' });
    } catch {
        throw new Error(
            'tmux is not available. Install it:\n' +
            '  macOS: brew install tmux\n' +
            '  Ubuntu/Debian: sudo apt-get install tmux\n' +
            '  Fedora: sudo dnf install tmux'
        );
    }
}

export function sessionName(teamName, workerName) {
    return `${TMUX_SESSION_PREFIX}-${sanitizeName(teamName)}-${sanitizeName(workerName)}`;
}

/**
 * Create a tmux topology for leader + N workers.
 *
 * SIGNATURE CHANGE from OMC: instead of `(teamName, workerCount, cwd)` we take
 * `(teamName, workers, options)` where `workers: [{name, cwd}]`. Each worker
 * pane is launched at its own `cwd`, lifting OMC's single-cwd constraint.
 *
 * Returns { sessionName, leaderPaneId, workerPanes: [{name, paneId}], sessionMode }.
 */
export async function createTeamSession(teamName, workers, options = {}) {
    validateTeamName(teamName);
    const multiplexerContext = detectTeamMultiplexerContext();
    const inTmux = multiplexerContext === 'tmux';
    const useDedicatedWindow = Boolean(options.newWindow && inTmux);

    if (!inTmux) {
        validateTmux();
    }

    const envPaneIdRaw = (process.env.TMUX_PANE ?? '').trim();
    const envPaneId = /^%\d+$/.test(envPaneIdRaw) ? envPaneIdRaw : '';
    let sessionAndWindow = '';
    let leaderPaneId = envPaneId;
    let sessionMode = inTmux ? 'split-pane' : 'detached-session';

    // Detached fallback: create a new tmux session, leader cwd defaults to first worker's cwd or HOME.
    if (!inTmux) {
        const leaderCwd = options.leaderCwd || workers[0]?.cwd || process.env.HOME || '/';
        const detachedSessionName = `${TMUX_SESSION_PREFIX}-${sanitizeName(teamName)}-${Date.now().toString(36)}`;
        const detachedResult = await tmuxExecAsync([
            'new-session', '-d', '-P', '-F', '#S:0 #{pane_id}',
            '-s', detachedSessionName,
            '-c', leaderCwd,
        ], { stripTmux: true });
        const detachedLine = detachedResult.stdout.trim();
        const detachedMatch = detachedLine.match(/^(\S+)\s+(%\d+)$/);
        if (!detachedMatch) {
            throw new Error(`Failed to create detached tmux session: "${detachedLine}"`);
        }
        sessionAndWindow = detachedMatch[1];
        leaderPaneId = detachedMatch[2];
    }

    if (inTmux && envPaneId) {
        try {
            const targetedContextResult = await tmuxExecAsync([
                'display-message', '-p', '-t', envPaneId, '#S:#I',
            ]);
            sessionAndWindow = targetedContextResult.stdout.trim();
        } catch {
            sessionAndWindow = '';
            leaderPaneId = '';
        }
    }

    if (!sessionAndWindow || !leaderPaneId) {
        const contextResult = await tmuxCmdAsync(['display-message', '-p', '#S:#I #{pane_id}']);
        const contextLine = contextResult.stdout.trim();
        const contextMatch = contextLine.match(/^(\S+)\s+(%\d+)$/);
        if (!contextMatch) {
            throw new Error(`Failed to resolve tmux context: "${contextLine}"`);
        }
        sessionAndWindow = contextMatch[1];
        leaderPaneId = contextMatch[2];
    }

    if (useDedicatedWindow) {
        const targetSession = sessionAndWindow.split(':')[0] ?? sessionAndWindow;
        const windowName = `mt-${sanitizeName(teamName)}`.slice(0, 32);
        const newWindowResult = await tmuxExecAsync([
            'new-window', '-d', '-P', '-F', '#S:#I #{pane_id}',
            '-t', targetSession,
            '-n', windowName,
            '-c', workers[0]?.cwd || process.env.HOME || '/',
        ]);
        const newWindowLine = newWindowResult.stdout.trim();
        const newWindowMatch = newWindowLine.match(/^(\S+)\s+(%\d+)$/);
        if (!newWindowMatch) {
            throw new Error(`Failed to create team tmux window: "${newWindowLine}"`);
        }
        sessionAndWindow = newWindowMatch[1];
        leaderPaneId = newWindowMatch[2];
        sessionMode = 'dedicated-window';
    }

    const teamTarget = sessionAndWindow;
    const resolvedSessionName = teamTarget.split(':')[0];
    const workerPanes = [];

    if (!workers || workers.length === 0) {
        return { sessionName: teamTarget, leaderPaneId, workerPanes, sessionMode };
    }

    // === CORE CHANGE: per-worker cwd ===
    // Split direction alternates h/v so tiled layout (applied below) has
    // something to work with even before re-layout. Final geometry is
    // determined by `select-layout tiled`.
    for (let i = 0; i < workers.length; i++) {
        const w = workers[i];
        if (!w?.cwd) throw new Error(`Worker '${w?.name}' missing cwd`);
        const splitTarget = i === 0 ? leaderPaneId : workerPanes[i - 1].paneId;
        const splitType = i % 2 === 0 ? '-h' : '-v';
        const splitResult = await tmuxCmdAsync([
            'split-window', splitType, '-t', splitTarget,
            '-d', '-P', '-F', '#{pane_id}',
            '-c', w.cwd,                              // ← PER-WORKER CWD (the whole point)
        ]);
        const paneId = splitResult.stdout.split('\n')[0]?.trim();
        if (paneId) {
            workerPanes.push({ name: w.name, paneId });
            // Store worker name in a pane-scoped user option. pane-border-format
            // reads @worker_name, which the worker CLI cannot overwrite via OSC.
            try {
                await tmuxExecAsync(['set-option', '-p', '-t', paneId, '@worker_name', w.name]);
            } catch { /* ignore — title is cosmetic */ }
        }
    }

    // Also label the leader pane so it's not blank in the grid.
    try {
        await tmuxExecAsync(['select-pane', '-t', leaderPaneId, '-T', 'leader']);
    } catch { /* ignore */ }

    await applyTeamLayout(teamTarget);
    try { await tmuxExecAsync(['set-option', '-t', resolvedSessionName, 'mouse', 'on']); } catch { /* ignore */ }
    if (sessionMode !== 'dedicated-window') {
        try { await tmuxExecAsync(['select-pane', '-t', leaderPaneId]); } catch { /* ignore */ }
    }
    await sleep(300);
    return { sessionName: teamTarget, leaderPaneId, workerPanes, sessionMode };
}

/**
 * Spawn a worker CLI in a specific pane.
 */
export async function spawnWorkerInPane(_sessionName, paneId, config) {
    validateTeamName(config.teamName);
    const startCmd = buildWorkerStartCommand(config);
    await tmuxExecAsync(['send-keys', '-t', paneId, '-l', startCmd]);
    await tmuxExecAsync(['send-keys', '-t', paneId, 'Enter']);
}

function normalizeTmuxCapture(value) {
    return value.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

async function capturePaneAsync(paneId) {
    try {
        const result = await tmuxExecAsync(['capture-pane', '-t', paneId, '-p', '-S', '-80']);
        return result.stdout;
    } catch {
        return '';
    }
}

function paneHasTrustPrompt(captured) {
    const lines = captured.split('\n').map((l) => l.replace(/\r/g, '').trim()).filter((l) => l.length > 0);
    const tail = lines.slice(-12);
    return tail.some((l) => /Do you trust the contents of this directory\?/i.test(l)) &&
        tail.some((l) => /Yes,\s*continue|No,\s*quit|Press enter to continue/i.test(l));
}

function paneIsBootstrapping(captured) {
    const lines = captured.split('\n').map((l) => l.replace(/\r/g, '').trim()).filter((l) => l.length > 0);
    return lines.some((l) =>
        /\b(loading|initializing|starting up)\b/i.test(l) ||
        /\bmodel:\s*loading\b/i.test(l) ||
        /\bconnecting\s+to\b/i.test(l)
    );
}

export function paneHasActiveTask(captured) {
    const lines = captured.split('\n').map((l) => l.replace(/\r/g, '').trim()).filter((l) => l.length > 0);
    const tail = lines.slice(-40);
    if (tail.some((l) => /\b\d+\s+background terminal running\b/i.test(l))) return true;
    if (tail.some((l) => /esc to interrupt/i.test(l))) return true;
    if (tail.some((l) => /\bbackground terminal running\b/i.test(l))) return true;
    return false;
}

export function paneLooksReady(captured) {
    const content = captured.trimEnd();
    if (content === '') return false;
    const lines = content.split('\n').map((l) => l.replace(/\r/g, '').trimEnd()).filter((l) => l.trim() !== '');
    if (lines.length === 0) return false;
    if (paneIsBootstrapping(content)) return false;
    const lastLine = lines[lines.length - 1];
    if (/^\s*[›>❯]\s*/u.test(lastLine)) return true;
    return lines.some((l) => /^\s*›\s*/u.test(l)) || lines.some((l) => /^\s*❯\s*/u.test(l));
}

export async function waitForPaneReady(paneId, opts = {}) {
    const envTimeout = Number.parseInt(process.env.MY_TEAM_SHELL_READY_TIMEOUT_MS ?? '', 10);
    const timeoutMs = Number.isFinite(opts.timeoutMs) && (opts.timeoutMs ?? 0) > 0
        ? Number(opts.timeoutMs)
        : (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 30_000);
    const pollIntervalMs = Number.isFinite(opts.pollIntervalMs) && (opts.pollIntervalMs ?? 0) > 0
        ? Number(opts.pollIntervalMs) : 250;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const captured = await capturePaneAsync(paneId);
        if (paneLooksReady(captured) && !paneHasActiveTask(captured)) return true;
        await sleep(pollIntervalMs);
    }
    console.warn(`[tmux-session] waitForPaneReady: pane ${paneId} timed out after ${timeoutMs}ms`);
    return false;
}

function paneTailContainsLiteralLine(captured, text) {
    return normalizeTmuxCapture(captured).includes(normalizeTmuxCapture(text));
}

async function paneInCopyMode(paneId) {
    try {
        const result = await tmuxCmdAsync(['display-message', '-t', paneId, '-p', '#{pane_in_mode}']);
        return result.stdout.trim() === '1';
    } catch {
        return false;
    }
}

/**
 * Send a short trigger message to a worker pane via tmux send-keys.
 * Robust against busy panes / copy-mode / trust prompts.
 * Returns false on failure (does not throw). Message must be < 200 chars.
 */
export async function sendToWorker(_sessionName, paneId, message) {
    if (message.length > 200) {
        console.warn(`[tmux-session] sendToWorker: message rejected (${message.length} chars exceeds 200 char limit)`);
        return false;
    }
    try {
        const sendKey = async (key) => {
            await tmuxExecAsync(['send-keys', '-t', paneId, key]);
        };
        if (await paneInCopyMode(paneId)) return false;

        const initialCapture = await capturePaneAsync(paneId);
        const paneBusy = paneHasActiveTask(initialCapture);
        if (paneHasTrustPrompt(initialCapture)) {
            await sendKey('C-m'); await sleep(120); await sendKey('C-m'); await sleep(200);
        }

        await tmuxExecAsync(['send-keys', '-t', paneId, '-l', '--', message]);
        await sleep(150);

        for (let round = 0; round < 6; round++) {
            await sleep(100);
            if (round === 0 && paneBusy) {
                await sendKey('Tab'); await sleep(80); await sendKey('C-m');
            } else {
                await sendKey('C-m'); await sleep(200); await sendKey('C-m');
            }
            await sleep(140);
            const check = await capturePaneAsync(paneId);
            if (!paneTailContainsLiteralLine(check, message)) return true;
            await sleep(140);
        }

        if (await paneInCopyMode(paneId)) return false;
        await sendKey('C-m'); await sleep(120); await sendKey('C-m'); await sleep(140);
        const final = await capturePaneAsync(paneId);
        if (!final || final.trim() === '') return false;
        return !paneTailContainsLiteralLine(final, message);
    } catch {
        return false;
    }
}

export async function injectToLeaderPane(_sessionName, leaderPaneId, message) {
    const prefixed = `[MY_TEAM_INJECT] ${message}`.slice(0, 200);
    try {
        if (await paneInCopyMode(leaderPaneId)) return false;
        const captured = await capturePaneAsync(leaderPaneId);
        if (paneHasActiveTask(captured)) {
            await tmuxExecAsync(['send-keys', '-t', leaderPaneId, 'C-c']);
            await sleep(250);
        }
    } catch { /* best-effort */ }
    return sendToWorker('', leaderPaneId, prefixed);
}

function isTmuxPaneNotFoundError(error) {
    const err = error;
    const text = [err?.stderr, err?.stdout, err?.message]
        .filter((p) => typeof p === 'string').join('\n').toLowerCase();
    return /can't find pane|can't find window|can't find session|no such pane|pane not found|unknown pane/.test(text);
}

export async function getWorkerLiveness(paneId) {
    try {
        const result = await tmuxCmdAsync(['display-message', '-t', paneId, '-p', '#{pane_dead}']);
        return result.stdout.trim() === '0' ? 'alive' : 'dead';
    } catch (error) {
        return isTmuxPaneNotFoundError(error) ? 'dead' : 'unknown';
    }
}

export async function isWorkerAlive(paneId) {
    return (await getWorkerLiveness(paneId)) === 'alive';
}

/**
 * Graceful-then-force shutdown. Writes a sentinel, waits up to `graceMs`,
 * then force-kills any remaining worker panes. Never kills the leader.
 */
export async function killWorkerPanes(opts) {
    const { paneIds, leaderPaneId, teamName, cwd, graceMs = 10_000 } = opts;
    if (!paneIds.length) return;
    const shutdownPath = join(cwd, '.omc', 'state', 'team', teamName, 'shutdown.json');
    try {
        await fs.mkdir(join(shutdownPath, '..'), { recursive: true });
        await fs.writeFile(shutdownPath, JSON.stringify({ requestedAt: Date.now() }));
        const aliveChecks = await Promise.all(paneIds.map((id) => isWorkerAlive(id)));
        if (aliveChecks.some((alive) => alive)) await sleep(graceMs);
    } catch { /* sentinel write failure non-fatal */ }

    for (const paneId of paneIds) {
        if (paneId === leaderPaneId) continue;
        try { await tmuxExecAsync(['kill-pane', '-t', paneId]); } catch { /* gone */ }
    }
}

/**
 * Kill the team session entirely (for detached-session/dedicated-window),
 * or kill worker panes only (for split-pane), preserving leader pane.
 */
export async function killTeamSession(sessionName, workerPaneIds, leaderPaneId, options = {}) {
    const sessionMode = options.sessionMode
        ?? (sessionName.includes(':') ? 'split-pane' : 'detached-session');
    if (sessionMode === 'split-pane') {
        if (!workerPaneIds?.length) return;
        for (const id of workerPaneIds) {
            if (id === leaderPaneId) continue;
            try { await tmuxExecAsync(['kill-pane', '-t', id]); } catch { /* gone */ }
        }
        return;
    }
    if (sessionMode === 'dedicated-window') {
        try { await tmuxExecAsync(['kill-window', '-t', sessionName]); } catch { /* gone */ }
        return;
    }
    const sessionTarget = sessionName.split(':')[0] ?? sessionName;
    if (process.env.MY_TEAM_ALLOW_KILL_CURRENT_SESSION !== '1' && process.env.TMUX) {
        try {
            const current = await tmuxCmdAsync(['display-message', '-p', '#S']);
            if (current.stdout.trim() === sessionTarget) return;
        } catch { /* best effort */ }
    }
    try { await tmuxExecAsync(['kill-session', '-t', sessionTarget]); } catch { /* gone */ }
}

/** True if pane id matches the `%N` tmux pane-id format. */
export function isPaneId(value) {
    return typeof value === 'string' && /^%\d+$/.test(value.trim());
}

export { existsSync };
