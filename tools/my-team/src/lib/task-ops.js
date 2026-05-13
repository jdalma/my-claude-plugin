/**
 * Simplified task lifecycle for my-team.
 *
 * Adapted in spirit from oh-my-claude-sisyphus `dist/team/task-file-ops.js`,
 * but stripped down to what my-team actually needs:
 *  - No claim_token, no withTaskLock, no race-condition handling
 *    (worker = project 1:1 mapping makes work-stealing impossible).
 *  - No retry sidecar (`*.failure.json`).
 *  - No legacy-path migration.
 *
 * Task file format (compatible with OMC `TaskFile`):
 *   { id, subject, description, status, owner, createdAt, updatedAt }
 *   status: 'pending' | 'in_progress' | 'completed' | 'failed'
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

import { atomicWriteJson, ensureDirWithMode, validateResolvedPath } from './fs-utils.js';
import { sanitizeName } from './team-name.js';

function sanitizeTaskId(taskId) {
    if (!/^[A-Za-z0-9._-]+$/.test(String(taskId))) {
        throw new Error(`Invalid task ID: "${taskId}" contains unsafe characters`);
    }
    return String(taskId);
}

function tasksDir(stateRoot, teamName) {
    const dir = join(stateRoot, sanitizeName(teamName), 'tasks');
    validateResolvedPath(dir, stateRoot);
    return dir;
}

function taskPath(stateRoot, teamName, taskId) {
    return join(tasksDir(stateRoot, teamName), `${sanitizeTaskId(taskId)}.json`);
}

/** Read a task. Returns null if not found or malformed. */
export function readTask(stateRoot, teamName, taskId) {
    const filePath = taskPath(stateRoot, teamName, taskId);
    if (!existsSync(filePath)) return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
        return null;
    }
}

/** Write a task (overwrites). */
export function writeTask(stateRoot, teamName, task) {
    const filePath = taskPath(stateRoot, teamName, task.id);
    ensureDirWithMode(tasksDir(stateRoot, teamName));
    atomicWriteJson(filePath, task);
    return filePath;
}

/** Update specific fields atomically. */
export function updateTask(stateRoot, teamName, taskId, updates) {
    const existing = readTask(stateRoot, teamName, taskId);
    if (!existing) throw new Error(`Task '${taskId}' not found`);
    const merged = { ...existing };
    for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) merged[k] = v;
    }
    merged.updatedAt = new Date().toISOString();
    return writeTask(stateRoot, teamName, merged);
}

/**
 * Transition status. Validates source state (best-effort).
 * Simplified: no claim_token check.
 */
export function transitionTaskStatus(stateRoot, teamName, taskId, from, to) {
    const VALID = new Set(['pending', 'in_progress', 'completed', 'failed']);
    if (!VALID.has(to)) throw new Error(`Invalid target status: "${to}"`);

    const task = readTask(stateRoot, teamName, taskId);
    if (!task) throw new Error(`Task '${taskId}' not found`);
    if (from && task.status !== from) {
        throw new Error(`Task '${taskId}' status is '${task.status}', not '${from}'`);
    }
    return updateTask(stateRoot, teamName, taskId, { status: to });
}

/** List task IDs sorted ascending (numeric if possible, else string). */
export function listTaskIds(stateRoot, teamName) {
    const dir = tasksDir(stateRoot, teamName);
    if (!existsSync(dir)) return [];
    try {
        return readdirSync(dir)
            .filter((f) => f.endsWith('.json') && !f.includes('.tmp.'))
            .map((f) => f.replace(/\.json$/, ''))
            .sort((a, b) => {
                const na = parseInt(a, 10), nb = parseInt(b, 10);
                if (!isNaN(na) && !isNaN(nb)) return na - nb;
                return a.localeCompare(b);
            });
    } catch {
        return [];
    }
}

/** Next free task ID (max existing + 1, or "1"). */
export function nextTaskId(stateRoot, teamName) {
    const ids = listTaskIds(stateRoot, teamName);
    const numeric = ids.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
    const max = numeric.length > 0 ? Math.max(...numeric) : 0;
    return String(max + 1);
}

/** Create a new task with auto-assigned ID. */
export function createTask(stateRoot, teamName, { subject, description, owner, id }) {
    if (!subject) throw new Error('subject is required');
    const finalId = id ? sanitizeTaskId(id) : nextTaskId(stateRoot, teamName);
    const now = new Date().toISOString();
    const task = {
        id: finalId,
        subject,
        description: description ?? '',
        status: 'pending',
        owner: owner ?? '',
        createdAt: now,
        updatedAt: now,
    };
    writeTask(stateRoot, teamName, task);
    return task;
}

/** Aggregate counts per status — used by `my-team status`. */
export function taskCounts(stateRoot, teamName) {
    const counts = { total: 0, pending: 0, in_progress: 0, completed: 0, failed: 0 };
    for (const id of listTaskIds(stateRoot, teamName)) {
        const t = readTask(stateRoot, teamName, id);
        if (!t) continue;
        counts.total++;
        if (Object.prototype.hasOwnProperty.call(counts, t.status)) {
            counts[t.status]++;
        }
    }
    return counts;
}
