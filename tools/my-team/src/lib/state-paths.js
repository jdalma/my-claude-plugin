/**
 * Adapted from oh-my-claude-sisyphus (MIT License)
 * https://github.com/Yeachan-Heo/oh-my-claudecode
 *
 * Source: dist/team/state-paths.js
 * Modifications:
 *  - Path prefix `.omc/state/team/<teamName>` is replaced by the absolute
 *    state root resolved from `MY_TEAM_STATE_ROOT` env or the supplied cwd.
 *  - `absPath(cwd, rel)` keeps the OMC signature for compatibility.
 */

import { isAbsolute, join } from 'path';

export function normalizeTaskFileStem(taskId) {
    const trimmed = String(taskId).trim().replace(/\.json$/i, '');
    if (/^task-\d+$/.test(trimmed)) return trimmed;
    if (/^\d+$/.test(trimmed)) return `task-${trimmed}`;
    return trimmed;
}

function resolveTeamRoot(teamName) {
    const envRoot = process.env.MY_TEAM_STATE_ROOT?.trim();
    if (envRoot) return envRoot;
    return `.omc/state/team/${teamName}`;
}

function p(teamName, ...parts) {
    return [resolveTeamRoot(teamName), ...parts].join('/');
}

export const TeamPaths = {
    root: (teamName) => resolveTeamRoot(teamName),
    config: (teamName) => p(teamName, 'config.json'),
    shutdown: (teamName) => p(teamName, 'shutdown.json'),
    tasks: (teamName) => p(teamName, 'tasks'),
    taskFile: (teamName, taskId) => p(teamName, 'tasks', `${normalizeTaskFileStem(taskId)}.json`),
    workers: (teamName) => p(teamName, 'workers'),
    workerDir: (teamName, workerName) => p(teamName, 'workers', workerName),
    heartbeat: (teamName, workerName) => p(teamName, 'workers', workerName, 'heartbeat.json'),
    inbox: (teamName, workerName) => p(teamName, 'workers', workerName, 'inbox.md'),
    outbox: (teamName, workerName) => p(teamName, 'workers', workerName, 'outbox.jsonl'),
    ready: (teamName, workerName) => p(teamName, 'workers', workerName, '.ready'),
    overlay: (teamName, workerName) => p(teamName, 'workers', workerName, 'AGENTS.md'),
    shutdownAck: (teamName, workerName) => p(teamName, 'workers', workerName, 'shutdown-ack.json'),
    mailbox: (teamName, workerName) => p(teamName, 'mailbox', `${workerName}.json`),
    archive: (teamName, workerName) => p(teamName, 'archive', `${workerName}.jsonl`),
    incomingSpoolDir: (teamName, workerName) => p(teamName, 'incoming-spool', workerName),
    incomingSpoolFile: (teamName, workerName, messageId) =>
        p(teamName, 'incoming-spool', workerName, `${messageId}.json`),
    workerStatus: (teamName, workerName) => p(teamName, 'workers', workerName, 'status.json'),
    workerIdentity: (teamName, workerName) => p(teamName, 'workers', workerName, 'identity.json'),
    manifest: (teamName) => p(teamName, 'manifest.json'),
};

export function absPath(cwd, relativePath) {
    return isAbsolute(relativePath) ? relativePath : join(cwd, relativePath);
}

export function teamStateRoot(cwd, teamName) {
    return absPath(cwd, TeamPaths.root(teamName));
}

export function getTaskStoragePath(cwd, teamName, taskId) {
    if (taskId !== undefined) return absPath(cwd, TeamPaths.taskFile(teamName, taskId));
    return absPath(cwd, TeamPaths.tasks(teamName));
}

/**
 * Legacy task storage path. my-team does not write here; kept so OMC's
 * task-file-ops migration shim still compiles.
 */
export function getLegacyTaskStoragePath(claudeConfigDir, teamName, taskId) {
    if (taskId !== undefined) return join(claudeConfigDir, 'tasks', teamName, `${taskId}.json`);
    return join(claudeConfigDir, 'tasks', teamName);
}
