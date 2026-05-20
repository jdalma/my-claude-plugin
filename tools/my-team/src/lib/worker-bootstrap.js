/**
 * Adapted from oh-my-claude-sisyphus (MIT License)
 * https://github.com/Yeachan-Heo/oh-my-claudecode
 *
 * Source: dist/team/worker-bootstrap.js
 * Modifications:
 *  - import paths rewired to our local lib modules.
 *  - `sanitizeName` now imported from `./team-name.js` (was tmux-session.js).
 *  - logic and output identical to OMC. CLI strings produced via
 *    `formatOmcCliInvocation` automatically use `my-team` prefix.
 */

import { mkdir, writeFile, appendFile } from 'fs/promises';
import { join, dirname } from 'path';

import { sanitizePromptContent } from './prompt-helpers.js';
import { formatOmcCliInvocation } from './cli-rendering.js';
import { sanitizeName } from './team-name.js';
import { validateResolvedPath } from './fs-utils.js';

const DEFAULT_INSTRUCTION_STATE_ROOT = '.omc/state';

function buildInstructionPath(...parts) {
    return join(...parts).replaceAll('\\', '/');
}

function buildTeamStateInstructionPath(teamName, instructionStateRoot, ...teamRelativeParts) {
    const baseParts = instructionStateRoot === DEFAULT_INSTRUCTION_STATE_ROOT
        ? [instructionStateRoot, 'team', teamName]
        : [instructionStateRoot];
    return buildInstructionPath(...baseParts, ...teamRelativeParts);
}

export function generateTriggerMessage(teamName, workerName, teamStateRoot = DEFAULT_INSTRUCTION_STATE_ROOT) {
    const inboxPath = buildTeamStateInstructionPath(teamName, teamStateRoot, 'workers', workerName, 'inbox.md');
    if (teamStateRoot !== DEFAULT_INSTRUCTION_STATE_ROOT) {
        return `Read ${inboxPath}, work now, report progress.`;
    }
    return `Read ${inboxPath}, execute now, report concrete progress.`;
}

export function generatePromptModeStartupPrompt(teamName, workerName, teamStateRoot = DEFAULT_INSTRUCTION_STATE_ROOT, cliOutputContract) {
    const inboxPath = buildTeamStateInstructionPath(teamName, teamStateRoot, 'workers', workerName, 'inbox.md');
    const base = `Open ${inboxPath}. Follow it and begin the assigned work.`;
    return cliOutputContract ? `${base}\n${cliOutputContract}` : base;
}

export function generateMailboxTriggerMessage(teamName, workerName, count = 1, teamStateRoot = DEFAULT_INSTRUCTION_STATE_ROOT) {
    const normalizedCount = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
    const mailboxPath = buildTeamStateInstructionPath(teamName, teamStateRoot, 'mailbox', `${workerName}.json`);
    if (teamStateRoot !== DEFAULT_INSTRUCTION_STATE_ROOT) {
        return `${normalizedCount} new msg(s): check ${mailboxPath}, act and report progress.`;
    }
    return `${normalizedCount} new msg(s). Read ${mailboxPath}, act now, report concrete progress.`;
}

function agentTypeGuidance(agentType) {
    const teamApiCommand = formatOmcCliInvocation('team api');
    const claimTaskCommand = formatOmcCliInvocation('team api claim-task');
    const transitionTaskStatusCommand = formatOmcCliInvocation('team api transition-task-status');
    switch (agentType) {
        case 'codex':
            return [
                '### Agent-Type Guidance (codex)',
                `- Prefer short, explicit \`${teamApiCommand} ... --json\` commands and parse outputs before next step.`,
                '- If a command fails, surface the exact stderr to the user in this pane (normal codex confirmation/prompt flow) before retrying.',
                `- You MUST run \`${claimTaskCommand}\` before starting work and \`${transitionTaskStatusCommand}\` when done.`,
            ].join('\n');
        case 'gemini':
            return [
                '### Agent-Type Guidance (gemini)',
                '- Execute task work in small, verifiable increments. The user observes this pane directly; surface milestones via your normal stdout (no separate channel needed).',
                '- Keep commit-sized changes scoped to assigned files only; no broad refactors.',
                `- CRITICAL: You MUST run \`${claimTaskCommand}\` before starting work and \`${transitionTaskStatusCommand}\` when done. Do not exit without transitioning the task status.`,
            ].join('\n');
        case 'cursor':
            return [
                '### Agent-Type Guidance (cursor)',
                '- You are an interactive REPL (cursor-agent), not a one-shot CLI. Stay in the session; the user observes this pane and other workers reach you via mailbox.',
                `- You MUST run \`${claimTaskCommand}\` before starting work and \`${transitionTaskStatusCommand}\` when done. Then keep waiting for the next mailbox message; do NOT type \`/exit\` unless the user types one in this pane.`,
                '- Reviewer/critic/security-review roles are NOT supported for cursor workers — those require a verdict-file write-and-exit which the REPL does not perform. Take only executor-style tasks.',
            ].join('\n');
        case 'claude':
        default:
            return [
                '### Agent-Type Guidance (claude)',
                '- Keep reasoning focused on assigned task IDs. The user observes this pane directly; surface progress via your normal stdout.',
                '- Before any risky command, ask the user in this pane via your normal Claude permission/confirmation prompt and wait for their answer.',
            ].join('\n');
    }
}

export function generateWorkerOverlay(params) {
    const { teamName, workerName, agentType, tasks, bootstrapInstructions } = params;
    const instructionStateRoot = params.instructionStateRoot ?? DEFAULT_INSTRUCTION_STATE_ROOT;
    const teamRoster = Array.isArray(params.teamRoster) ? params.teamRoster : [];

    const sanitizedTasks = tasks.map((t) => ({
        id: t.id,
        subject: sanitizePromptContent(t.subject),
        description: sanitizePromptContent(t.description),
    }));

    const sentinelPath = buildTeamStateInstructionPath(teamName, instructionStateRoot, 'workers', workerName, '.ready');
    const heartbeatPath = buildTeamStateInstructionPath(teamName, instructionStateRoot, 'workers', workerName, 'heartbeat.json');
    const inboxPath = buildTeamStateInstructionPath(teamName, instructionStateRoot, 'workers', workerName, 'inbox.md');
    const statusPath = buildTeamStateInstructionPath(teamName, instructionStateRoot, 'workers', workerName, 'status.json');
    const shutdownAckPath = buildTeamStateInstructionPath(teamName, instructionStateRoot, 'workers', workerName, 'shutdown-ack.json');

    const claimTaskCommand = formatOmcCliInvocation(`team api claim-task --input "{\\"team_name\\":\\"${teamName}\\",\\"task_id\\":\\"<id>\\",\\"worker\\":\\"${workerName}\\"}" --json`);
    const completeTaskCommand = formatOmcCliInvocation(`team api transition-task-status --input "{\\"team_name\\":\\"${teamName}\\",\\"task_id\\":\\"<id>\\",\\"from\\":\\"in_progress\\",\\"to\\":\\"completed\\",\\"claim_token\\":\\"<claim_token>\\",\\"result\\":\\"Summary: <what changed>\\\\nVerification: <tests/checks run>\\"}" --json`);
    const failTaskCommand = formatOmcCliInvocation(`team api transition-task-status --input "{\\"team_name\\":\\"${teamName}\\",\\"task_id\\":\\"<id>\\",\\"from\\":\\"in_progress\\",\\"to\\":\\"failed\\",\\"claim_token\\":\\"<claim_token>\\"}" --json`);
    const readTaskCommand = formatOmcCliInvocation(`team api read-task --input "{\\"team_name\\":\\"${teamName}\\",\\"task_id\\":\\"<id>\\"}" --json`);
    const mailboxListCommand = formatOmcCliInvocation(`team api mailbox-list --input "{\\"team_name\\":\\"${teamName}\\",\\"worker\\":\\"${workerName}\\"}" --json`);
    const mailboxDeliveredCommand = formatOmcCliInvocation(`team api mailbox-mark-delivered --input "{\\"team_name\\":\\"${teamName}\\",\\"worker\\":\\"${workerName}\\",\\"message_id\\":\\"<id>\\"}" --json`);
    const teamApiCommand = formatOmcCliInvocation('team api');
    const teamCommand = formatOmcCliInvocation('team');

    const taskList = sanitizedTasks.length > 0
        ? sanitizedTasks.map((t) => `- **Task ${t.id}**: ${t.subject}\n  Description: ${t.description}\n  Status: pending`).join('\n')
        : '- No tasks assigned yet. Check your inbox for assignments.';

    const rosterList = teamRoster.length > 0
        ? teamRoster
            .map((peer) => {
                const isSelf = peer.name === workerName;
                const selfTag = isSelf ? ' (you)' : '';
                const role = peer.role ? sanitizePromptContent(peer.role, 200).split('\n')[0].trim() : '';
                const roleSuffix = role ? ` — ${role}` : '';
                return `- **${peer.name}**${selfTag} [${peer.agentType}]${roleSuffix}`;
            })
            .join('\n')
        : '- (roster unavailable)';

    return `# Team Worker Protocol

You are one of N workers collaborating peer-to-peer. The user observes each
pane directly and intervenes through your normal CLI prompt when needed.
Other workers reach you through your mailbox.

## FIRST ACTION REQUIRED
Before doing anything else, write your ready sentinel file:
\`\`\`bash
mkdir -p $(dirname ${sentinelPath}) && touch ${sentinelPath}
\`\`\`

## MANDATORY WORKFLOW — Follow These Steps In Order
You MUST complete ALL of these steps. Do NOT skip any step. Do NOT exit without step 3.

1. **Claim** your task (run this command first):
   \`${claimTaskCommand}\`
   Save the \`claim_token\` from the response — you need it for step 3.
2. **Do the work** described in your task assignment below. The user
   observes this pane; if you need permission or confirmation, ask via
   your normal CLI prompt — do not route the question to any "leader".
3. **Transition** the task status (REQUIRED before exit):
   - On success: \`${completeTaskCommand}\`
   - On failure: \`${failTaskCommand}\`

## Identity
- **Team**: ${teamName}
- **Worker**: ${workerName}
- **Agent Type**: ${agentType}
- **Environment**: OMC_TEAM_WORKER=${teamName}/${workerName}

## Team Roster
These are the workers in this team. Use the exact \`name\` shown here as the
\`to_worker\` value when calling \`my-team api send-message\`. The same name is
also visible on each pane's top border.

Each entry shows that worker's role/specialty. When a sub-problem falls
outside your own scope but matches a peer's role, send that peer a message
instead of solving it yourself — that is what the roster is for.
${rosterList}

## Your Tasks
${taskList}

## Task Lifecycle Reference (CLI API)
- Inspect task state: \`${readTaskCommand}\`
- Task id format: State/CLI APIs use task_id: "<id>" (example: "1"), not "task-1"
- Claim task: \`${claimTaskCommand}\`
- Complete task: \`${completeTaskCommand}\`
- Fail task: \`${failTaskCommand}\`

## Communication Protocol
- **Inbox**: Read ${inboxPath} for new instructions
- **Status**: Write to ${statusPath}:
  \`\`\`json
  {"state": "idle", "updated_at": "<ISO timestamp>"}
  \`\`\`
  States: "idle" | "working" | "blocked" | "done" | "failed"
- **Heartbeat**: Update ${heartbeatPath} every few minutes:
  \`\`\`json
  {"pid":<pid>,"last_turn_at":"<ISO timestamp>","turn_count":<n>,"alive":true}
  \`\`\`

## Message Protocol
Talk to the user: surface output in this pane via your normal stdout. Permission
or confirmation requests use your CLI's native prompt (no "leader" channel).

Talk to other workers via CLI API:
- Send to peer: \`${formatOmcCliInvocation(`team api send-message --input "{\\"team_name\\":\\"${teamName}\\",\\"from_worker\\":\\"${workerName}\\",\\"to_worker\\":\\"<other-worker>\\",\\"body\\":\\"<message>\\"}" --json`)}\`
- Reply to a peer's message: same command, plus \`"reply_to":"<original message_id>"\` in the input.
- List unread mailbox messages: \`${mailboxListCommand}\`
- Mark a message consumed: \`${mailboxDeliveredCommand}\`

### All worker-to-worker messaging is ASYNCHRONOUS

There is no blocking send. You **never stop your own work to wait** for a
peer's reply. You send, you continue, and you pick up any reply later from
your mailbox. There is no system-enforced deadline or timeout — \`my-team\`
does not measure how long a reply takes.

### MANDATORY — Mailbox self-poll discipline

A tmux notification (\`new-message:<sender>\` typed into this pane) is a
**best-effort hint only**. It can be lost: if this pane was busy, in a
confirmation prompt, or in copy-mode when a peer sent to you, the trigger
never lands. Do NOT rely on it as your only signal.

Your mailbox file is the source of truth. You MUST poll it yourself:

1. **At the end of every work cycle** — before you yield your turn or go
   idle, run \`mailbox-list\`. Handle each returned message (see below).
2. **When you receive any \`new-message\` notification** — run \`mailbox-list\`
   immediately; the notification only tells you to check, not what changed.
3. **After handling a message** — run \`mailbox-mark-delivered\` for its
   \`message_id\`. \`mailbox-list\` returns only unconsumed messages by default,
   so marking is what stops you from reprocessing the same message.

\`mailbox-list\` returns \`{ ok, worker, messages }\`. An empty \`messages\`
array means no unread mail — that is normal, not an error. A thrown error
(malformed mailbox) is real; surface it in this pane's stdout.

### Handling a received message

For each message from \`mailbox-list\`:

- **\`reply_to\` is set** → this is an answer to a question *you* sent earlier.
  Match it to your original question by that \`message_id\`, use the answer,
  then \`mailbox-mark-delivered\`.
- **\`reply_to\` is null** → a fresh message from a peer. Read the \`body\`.
  If it asks you something and the sender needs an answer, send a reply with
  \`reply_to\` set to *this* message's \`message_id\`. If it is just an
  announcement or finished artifact, act on it (or note it) — no reply needed.
  Either way, \`mailbox-mark-delivered\` when done.

### When you send a message that needs an answer

Send it normally and **keep working** — do not block. The peer will reply as
its own next mailbox cycle allows. Your reply arrives in your mailbox with
\`reply_to\` pointing at your original \`message_id\`; your per-cycle
\`mailbox-list\` will surface it. If an answer is taking long enough to stall
your progress, surface that in this pane's stdout so the user can see it and
intervene — but do not freeze the worker waiting.

## Shutdown Protocol
When you see a shutdown request in your inbox:
1. Write your decision to: ${shutdownAckPath}
2. Format:
   - Accept: {"status":"accept","reason":"ok","updated_at":"<iso>"}
   - Reject: {"status":"reject","reason":"still working","updated_at":"<iso>"}
3. Exit your session

## Rules
- Do NOT edit files outside the paths listed in your task description
- Do NOT write lifecycle fields (status, owner, result, error) directly in task files; use CLI API
- Do NOT spawn sub-agents. Complete work in this worker session only.
- Do NOT create tmux panes/sessions (\`tmux split-window\`, \`tmux new-session\`, etc.).
- Do NOT run team spawning/orchestration commands (for example: \`${teamCommand} ...\`).
- Worker-allowed control surface is only: \`${teamApiCommand} ... --json\`.
- If blocked, write {"state": "blocked", "reason": "..."} to your status file and surface the block in this pane's stdout so the user sees it

${agentTypeGuidance(agentType)}

## BEFORE YOU EXIT
You MUST call \`${formatOmcCliInvocation('team api transition-task-status')}\` to mark your task as "completed" or "failed" before exiting.

${bootstrapInstructions ? `## Role Context\n${bootstrapInstructions}\n` : ''}`;
}

export async function composeInitialInbox(teamName, workerName, content, cwd) {
    const inboxPath = join(cwd, `.omc/state/team/${teamName}/workers/${workerName}/inbox.md`);
    await mkdir(dirname(inboxPath), { recursive: true });
    await writeFile(inboxPath, content, 'utf-8');
}

export async function appendToInbox(teamName, workerName, message, cwd) {
    const safeTeam = sanitizeName(teamName);
    const safeWorker = sanitizeName(workerName);
    const inboxPath = join(cwd, `.omc/state/team/${safeTeam}/workers/${safeWorker}/inbox.md`);
    validateResolvedPath(inboxPath, cwd);
    await mkdir(dirname(inboxPath), { recursive: true });
    await appendFile(inboxPath, `\n\n---\n${message}`, 'utf-8');
}

export async function ensureWorkerStateDir(teamName, workerName, cwd) {
    const workerDir = join(cwd, `.omc/state/team/${teamName}/workers/${workerName}`);
    await mkdir(workerDir, { recursive: true });
    const mailboxDir = join(cwd, `.omc/state/team/${teamName}/mailbox`);
    await mkdir(mailboxDir, { recursive: true });
    const tasksDir = join(cwd, `.omc/state/team/${teamName}/tasks`);
    await mkdir(tasksDir, { recursive: true });
}

export async function writeWorkerOverlay(params) {
    const { teamName, workerName, cwd } = params;
    const overlay = generateWorkerOverlay(params);
    const overlayPath = join(cwd, `.omc/state/team/${teamName}/workers/${workerName}/AGENTS.md`);
    await mkdir(dirname(overlayPath), { recursive: true });
    await writeFile(overlayPath, overlay, 'utf-8');
    return overlayPath;
}
