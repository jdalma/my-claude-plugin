/**
 * `my-team` CLI entry point.
 *
 * Subcommands (user-facing):
 *   start, status, msg, add-task, shutdown
 *
 * api subcommands (called by worker LLMs from AGENTS.md):
 *   api transition-task-status, api send-message, api read-task,
 *   api create-task, api claim-task (noop),
 *   api mailbox-list, api mailbox-mark-delivered
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { runStart } from './commands/start.js';
import { runStatus } from './commands/status.js';
import { runMsg } from './commands/msg.js';
import { runAddTask } from './commands/add-task.js';
import { runShutdown } from './commands/shutdown.js';
import { runMonitor } from './commands/monitor.js';

import { runApiTransitionTaskStatus } from './commands/api/transition-task-status.js';
import { runApiSendMessage } from './commands/api/send-message.js';
import { runApiReadTask } from './commands/api/read-task.js';
import { runApiCreateTask } from './commands/api/create-task.js';
import { runApiMailboxList } from './commands/api/mailbox-list.js';
import { runApiMailboxMarkDelivered } from './commands/api/mailbox-mark-delivered.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readVersion() {
    try {
        const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
        return pkg.version;
    } catch {
        return '0.0.0';
    }
}

function parseApiInput(opts) {
    if (!opts.input) {
        throw new Error('--input <json> is required for api subcommands');
    }
    try {
        return JSON.parse(opts.input);
    } catch (err) {
        throw new Error(`--input is not valid JSON: ${err.message}`);
    }
}

function emit(result, jsonOutput) {
    if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
    } else if (result !== undefined) {
        console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    }
}

async function main() {
    const program = new Command();
    program
        .name('my-team')
        .description('Multi-project tmux worker orchestration with per-worker cwd.')
        .version(readVersion());

    // start
    program
        .command('start')
        .description('Boot a team from config or inline workers')
        .option('--config <path>', 'config file path (JSON)')
        .option('--name <name>', 'team name (for inline mode)')
        .option('--worker <spec>', 'inline worker: name:agent_type:cwd', (v, prev) => {
            prev = prev || [];
            prev.push(v);
            return prev;
        })
        .option('--new-window', 'create new tmux window instead of splitting current')
        .option('--detached', 'force detached tmux session')
        .option('--dry-run', 'show plan without spawning')
        .action(async (opts) => {
            await runStart(opts);
        });

    // status
    program
        .command('status')
        .description('Show team state, workers, tasks')
        .requiredOption('--team <name>', 'team name')
        .option('--state-root <path>', 'override state root')
        .option('--json', 'JSON output')
        .action(async (opts) => {
            await runStatus(opts);
        });

    // msg
    program
        .command('msg')
        .description('Send free-form message to a worker inbox')
        .requiredOption('--team <name>', 'team name')
        .requiredOption('--to <worker>', 'worker name')
        .option('--body <text>', 'message body')
        .option('--from-file <path>', 'read body from file')
        .option('--no-trigger', 'skip tmux send-keys notification')
        .option('--state-root <path>', 'override state root')
        .action(async (opts) => {
            await runMsg(opts);
        });

    // add-task
    program
        .command('add-task')
        .description('Register a new tracked task and notify the worker')
        .requiredOption('--team <name>', 'team name')
        .requiredOption('--worker <name>', 'assignee worker')
        .requiredOption('--subject <text>', 'task subject (short)')
        .option('--description <text>', 'task description', '')
        .option('--description-file <path>', 'read description from file')
        .option('--id <id>', 'override task id')
        .option('--no-notify', 'do not notify the worker')
        .option('--state-root <path>', 'override state root')
        .action(async (opts) => {
            await runAddTask(opts);
        });

    // shutdown
    program
        .command('shutdown')
        .description('Terminate a team')
        .requiredOption('--team <name>', 'team name')
        .option('--force', 'kill immediately (no grace period)')
        .option('--state-root <path>', 'override state root')
        .action(async (opts) => {
            await runShutdown(opts);
        });

    // monitor
    program
        .command('monitor <team-name>')
        .description('Tail worker-to-worker message log in real-time (Ctrl+C to exit)')
        .option('--state-root <path>', 'override state root')
        .action(async (teamName, opts) => {
            await runMonitor(teamName, opts);
        });

    // api ...
    const api = program.command('api').description('Internal API used by worker LLMs');

    api.command('transition-task-status')
        .requiredOption('--input <json>', 'JSON payload')
        .option('--json', 'JSON output')
        .action((opts) => emit(runApiTransitionTaskStatus(parseApiInput(opts)), opts.json));

    api.command('send-message')
        .requiredOption('--input <json>', 'JSON payload')
        .option('--json', 'JSON output')
        .action(async (opts) => emit(await runApiSendMessage(parseApiInput(opts)), opts.json));

    api.command('read-task')
        .requiredOption('--input <json>', 'JSON payload')
        .option('--json', 'JSON output')
        .action((opts) => emit(runApiReadTask(parseApiInput(opts)), opts.json));

    api.command('create-task')
        .requiredOption('--input <json>', 'JSON payload')
        .option('--json', 'JSON output')
        .action(async (opts) => emit(await runApiCreateTask(parseApiInput(opts)), opts.json));

    api.command('mailbox-list')
        .requiredOption('--input <json>', 'JSON payload')
        .option('--json', 'JSON output')
        .action((opts) => emit(runApiMailboxList(parseApiInput(opts)), opts.json));

    api.command('mailbox-mark-delivered')
        .requiredOption('--input <json>', 'JSON payload')
        .option('--json', 'JSON output')
        .action((opts) => emit(runApiMailboxMarkDelivered(parseApiInput(opts)), opts.json));

    // claim-task: noop (AC-31). Workers may call it from OMC-style AGENTS.md.
    api.command('claim-task')
        .requiredOption('--input <json>', 'JSON payload')
        .option('--json', 'JSON output')
        .action((opts) => {
            const input = parseApiInput(opts);
            const claim_token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            emit({
                ok: true,
                task_id: input.task_id ?? null,
                worker: input.worker ?? null,
                claim_token,
                note: 'claim-task is a noop in my-team; token returned for OMC AGENTS.md compatibility.',
            }, opts.json);
        });

    try {
        await program.parseAsync(process.argv);
    } catch (err) {
        console.error(`[my-team] error: ${err.message}`);
        process.exit(1);
    }
}

main();
