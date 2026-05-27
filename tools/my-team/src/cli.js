/**
 * `my-team` CLI entry point.
 *
 * Subcommands (user-facing):
 *   start, status, shutdown, monitor
 *
 * api subcommands (called by worker LLMs from AGENTS.md) — peer messaging only:
 *   api send-message, api mailbox-list, api mailbox-mark-delivered,
 *   api archive-lookup
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { runStart } from './commands/start.js';
import { runStatus } from './commands/status.js';
import { runShutdown } from './commands/shutdown.js';
import { runMonitor } from './commands/monitor.js';

import { runApiSendMessage } from './commands/api/send-message.js';
import { runApiMailboxList } from './commands/api/mailbox-list.js';
import { runApiMailboxMarkDelivered } from './commands/api/mailbox-mark-delivered.js';
import { runApiArchiveLookup } from './commands/api/archive-lookup.js';

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

    // api ... (peer messaging only)
    const api = program.command('api').description('Internal API used by worker LLMs for peer messaging');

    api.command('send-message')
        .requiredOption('--input <json>', 'JSON payload')
        .option('--json', 'JSON output')
        .action(async (opts) => emit(await runApiSendMessage(parseApiInput(opts)), opts.json));

    api.command('mailbox-list')
        .requiredOption('--input <json>', 'JSON payload')
        .option('--json', 'JSON output')
        .action(async (opts) => emit(await runApiMailboxList(parseApiInput(opts)), opts.json));

    api.command('mailbox-mark-delivered')
        .requiredOption('--input <json>', 'JSON payload')
        .option('--json', 'JSON output')
        .action((opts) => emit(runApiMailboxMarkDelivered(parseApiInput(opts)), opts.json));

    api.command('archive-lookup')
        .requiredOption('--input <json>', 'JSON payload')
        .option('--json', 'JSON output')
        .action((opts) => emit(runApiArchiveLookup(parseApiInput(opts)), opts.json));

    try {
        await program.parseAsync(process.argv);
    } catch (err) {
        console.error(`[my-team] error: ${err.message}`);
        process.exit(1);
    }
}

main();
