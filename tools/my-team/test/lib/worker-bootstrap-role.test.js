/**
 * Role-aware AGENTS.md overlay tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorkerOverlay } from '../../src/lib/worker-bootstrap.js';

const roster = [
    { name: 'pm', agentType: 'claude', role: 'PM hub', teamRole: 'orchestrator' },
    { name: 'dev', agentType: 'claude', role: 'backend dev', teamRole: 'worker' },
];

function overlayFor(workerName, workerRole) {
    return generateWorkerOverlay({
        teamName: 'demo', workerName, agentType: 'claude',
        workerRole, teamRoster: roster, bootstrapInstructions: '',
    });
}

test('orchestrator overlay carries the delegation discipline and cross-team gateway duty', () => {
    const text = overlayFor('pm', 'orchestrator');
    assert.match(text, /## Team Role: ORCHESTRATOR/);
    assert.match(text, /ticket form/);
    assert.match(text, /sent_pending/);
    assert.match(text, /RFC file/);
    assert.doesNotMatch(text, /every worker \(including you\) is a peer/);
});

test('orchestrator overlay carries the cross-team Q&A quality rules', () => {
    const text = overlayFor('pm', 'orchestrator');
    assert.match(text, /read its published docs/, 'docs-first rule');
    assert.match(text, /Answers must cite evidence/, 'evidence citation rule');
    assert.match(text, /never replace the original with your summary/, 'no lossy relay rule');
    assert.match(text, /FAQ\/decisions log/, 'Q&A accumulation rule');
});

test('worker overlay carries the evidence discipline', () => {
    const text = overlayFor('dev', 'worker');
    assert.match(text, /must cite file:line/);
});

test('worker overlay names its orchestrators and blocks cross-team', () => {
    const text = overlayFor('dev', 'worker');
    assert.match(text, /## Team Role: WORKER/);
    assert.match(text, /\(pm\)/, 'must name the orchestrator(s)');
    assert.match(text, /Cross-team messaging is blocked/);
});

test('roster marks orchestrators', () => {
    const text = overlayFor('dev', 'worker');
    assert.match(text, /\*\*pm\*\* \[claude\] \[ORCHESTRATOR\]/);
    assert.doesNotMatch(text, /\*\*dev\*\*.*\[ORCHESTRATOR\]/);
});

test('legacy overlay (no role) keeps the peer-symmetric text and no role section', () => {
    const text = generateWorkerOverlay({
        teamName: 'demo', workerName: 'a', agentType: 'claude',
        teamRoster: [{ name: 'a', agentType: 'claude', role: '' }],
        bootstrapInstructions: '',
    });
    assert.match(text, /every worker \(including you\) is a peer/);
    assert.doesNotMatch(text, /## Team Role:/);
});

test('cross-team section documents to_team addressing', () => {
    const text = overlayFor('pm', 'orchestrator');
    assert.match(text, /to_team\\{0,2}":\\{0,2}"<team-name>/);
    assert.match(text, /Prefer `to_team`/);
});
