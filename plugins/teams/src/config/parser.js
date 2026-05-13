/**
 * Config parser and validator for my-team.
 *
 * Schema (TeamConfig):
 *   { team_name, state_root?, new_window?, detached?, workers: WorkerConfig[] }
 *
 * Implements AC-1, AC-19, AC-20, AC-24, AC-26, AC-27 from PLAN.md.
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { isAbsolute, join, resolve, dirname } from 'path';
import { homedir } from 'os';

import { validateTeamName } from '../lib/team-name.js';

const VALID_AGENT_TYPES = new Set(['claude', 'codex', 'gemini', 'cursor']);
const WORKER_NAME_PATTERN = /^[a-zA-Z0-9-]+$/;

function expandTilde(p) {
    if (!p) return p;
    if (p === '~') return homedir();
    if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
    return p;
}

/**
 * Auto-discover config file in callerCwd (AC-26).
 * Returns first match of: my-team.json, team.json. Null if neither exists.
 */
export function autoDiscoverConfig(callerCwd) {
    for (const name of ['my-team.json', 'team.json']) {
        const p = join(callerCwd, name);
        if (existsSync(p) && statSync(p).isFile()) return p;
    }
    return null;
}

/**
 * Load and validate a config file.
 * Returns normalized config object. Throws on validation failures.
 */
export function loadConfig(configPath) {
    if (!existsSync(configPath)) {
        throw new Error(`Config file not found: ${configPath}`);
    }
    let raw;
    try {
        raw = readFileSync(configPath, 'utf-8');
    } catch (err) {
        throw new Error(`Cannot read config file ${configPath}: ${err.message}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`Config file is not valid JSON: ${err.message}`);
    }
    return validateConfig(parsed, { configPath });
}

function isAbsoluteOrTilde(p) {
    return typeof p === 'string' && (p === '~' || p.startsWith('~/') || p.startsWith('~\\') || isAbsolute(p));
}

/**
 * Validate + normalize an in-memory config object.
 * Returns a normalized config with expanded paths and defaults filled in.
 */
export function validateConfig(cfg, { configPath } = {}) {
    if (!cfg || typeof cfg !== 'object') {
        throw new Error('Config must be a JSON object');
    }

    const { team_name, state_root, new_window, detached, workers } = cfg;

    if (typeof team_name !== 'string' || !team_name) {
        throw new Error('team_name is required (string)');
    }
    validateTeamName(team_name);

    // AC-24: state_root must be absolute or ~
    let resolvedStateRoot;
    if (state_root !== undefined) {
        if (typeof state_root !== 'string' || !isAbsoluteOrTilde(state_root)) {
            throw new Error(`state_root must be absolute or start with '~'. Got: ${JSON.stringify(state_root)}`);
        }
        resolvedStateRoot = expandTilde(state_root);
    } else {
        resolvedStateRoot = join(homedir(), '.my-team', 'sessions', team_name);
    }

    if (!Array.isArray(workers) || workers.length === 0) {
        throw new Error('workers must be a non-empty array');
    }
    if (workers.length > 10) {
        throw new Error(`workers cannot exceed 10. Got: ${workers.length}`);
    }

    const seen = new Set();
    const normalizedWorkers = workers.map((w, i) => validateWorker(w, i, seen));

    return {
        team_name,
        state_root: resolvedStateRoot,
        new_window: Boolean(new_window),
        detached: Boolean(detached),
        workers: normalizedWorkers,
        _configPath: configPath ?? null,
    };
}

function validateWorker(w, idx, seen) {
    const where = `workers[${idx}]`;
    if (!w || typeof w !== 'object') throw new Error(`${where} must be an object`);

    // AC-19: worker name pattern
    if (typeof w.name !== 'string' || !WORKER_NAME_PATTERN.test(w.name)) {
        throw new Error(`${where}.name must match /^[a-zA-Z0-9-]+$/. Got: ${JSON.stringify(w.name)}`);
    }
    if (seen.has(w.name)) {
        throw new Error(`Duplicate worker name: ${w.name}`);
    }
    seen.add(w.name);

    // AC-20: cwd absolute or ~
    if (typeof w.cwd !== 'string' || !isAbsoluteOrTilde(w.cwd)) {
        throw new Error(`${where}.cwd must be absolute or start with '~'. Got: ${JSON.stringify(w.cwd)}`);
    }
    const expandedCwd = expandTilde(w.cwd);
    if (!existsSync(expandedCwd)) {
        throw new Error(`${where}.cwd does not exist: ${expandedCwd}`);
    }
    if (!statSync(expandedCwd).isDirectory()) {
        throw new Error(`${where}.cwd is not a directory: ${expandedCwd}`);
    }

    // agent_type whitelist
    if (typeof w.agent_type !== 'string' || !VALID_AGENT_TYPES.has(w.agent_type)) {
        throw new Error(
            `${where}.agent_type must be one of ${[...VALID_AGENT_TYPES].join('|')}. Got: ${JSON.stringify(w.agent_type)}`
        );
    }

    // extra_prompt resolution (AC-27)
    let extraPrompt = '';
    if (typeof w.extra_prompt === 'string' && w.extra_prompt.trim()) {
        extraPrompt = w.extra_prompt;
        if (w.extra_prompt_file) {
            console.warn(
                `[my-team] worker '${w.name}': both extra_prompt and extra_prompt_file set, using inline (file ignored).`
            );
        }
    } else if (typeof w.extra_prompt_file === 'string' && w.extra_prompt_file) {
        const filePath = isAbsolute(w.extra_prompt_file)
            ? w.extra_prompt_file
            : expandTilde(w.extra_prompt_file);
        if (!existsSync(filePath)) {
            throw new Error(`${where}.extra_prompt_file does not exist: ${filePath}`);
        }
        extraPrompt = readFileSync(filePath, 'utf-8');
    }

    // task (optional)
    let task = null;
    if (w.task !== undefined) {
        if (!w.task || typeof w.task !== 'object') {
            throw new Error(`${where}.task must be an object with subject and description`);
        }
        if (typeof w.task.subject !== 'string' || !w.task.subject.trim()) {
            throw new Error(`${where}.task.subject is required`);
        }
        task = {
            subject: w.task.subject,
            description: typeof w.task.description === 'string' ? w.task.description : '',
        };
    }

    // env (optional)
    let env = {};
    if (w.env !== undefined) {
        if (!w.env || typeof w.env !== 'object') {
            throw new Error(`${where}.env must be an object of string values`);
        }
        for (const [k, v] of Object.entries(w.env)) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
                throw new Error(`${where}.env: invalid key '${k}'`);
            }
            if (typeof v !== 'string') {
                throw new Error(`${where}.env.${k} must be a string`);
            }
            env[k] = v;
        }
    }

    return {
        name: w.name,
        cwd: expandedCwd,
        agent_type: w.agent_type,
        extra_prompt: extraPrompt,
        task,
        env,
    };
}

/** Parse inline `--worker name:agent_type:cwd` spec into a WorkerConfig. */
export function parseInlineWorkerSpec(spec) {
    const parts = spec.split(':');
    if (parts.length < 3) {
        throw new Error(`Worker spec must be 'name:agent_type:cwd'. Got: ${spec}`);
    }
    const [name, agent_type, ...cwdParts] = parts;
    const cwd = cwdParts.join(':'); // rejoin in case cwd contains ':' (unlikely on posix)
    return { name, agent_type, cwd };
}
