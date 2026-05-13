/**
 * Helper to locate and load a team manifest by team name.
 * Tries env MY_TEAM_STATE_ROOT_BASE, then ~/.my-team/sessions/<team>.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function defaultBase() {
    return process.env.MY_TEAM_STATE_ROOT_BASE?.trim() || join(homedir(), '.my-team', 'sessions');
}

export function manifestPathForTeam(teamName, stateRoot) {
    if (stateRoot) return join(stateRoot, 'manifest.json');
    return join(defaultBase(), teamName, 'manifest.json');
}

export function loadManifest(teamName, stateRoot) {
    const p = manifestPathForTeam(teamName, stateRoot);
    if (!existsSync(p)) {
        throw new Error(`Team '${teamName}' manifest not found at ${p}. Is the team running?`);
    }
    try {
        return JSON.parse(readFileSync(p, 'utf-8'));
    } catch (err) {
        throw new Error(`Cannot parse manifest at ${p}: ${err.message}`);
    }
}
