# my-team

Multi-project tmux worker orchestration. Spawn N CLI workers (claude / codex / gemini / cursor) in tmux panes, **each at its own project directory**, with shared mailbox-based communication.

Adapted from [`oh-my-claude-sisyphus`](https://github.com/Yeachan-Heo/oh-my-claudecode) (MIT) — lifts its single-cwd constraint so a single team can span multiple unrelated repos.

## Status

**WIP** — see `PLAN.md` for the full 31-criterion acceptance set and implementation phases.

## Install

```bash
# from this directory
npm install
npm link    # exposes the `my-team` binary globally

# or run directly
./bin/my-team --help
```

Requires:
- Node.js ≥ 20
- `tmux`
- At least one of: `claude`, `codex`, `gemini`, `cursor-agent` on PATH

## Quick start

```bash
cat > my-team.json <<'EOF'
{
  "team_name": "demo",
  "workers": [
    {
      "name": "alpha",
      "cwd": "~/work/project-a",
      "agent_type": "claude",
      "launch_args": ["--dangerously-skip-permissions"],
      "description": "Backend API owner — DB schema and endpoint design.",
      "extra_prompt": "Project A is the backend.",
      "task": { "subject": "Sketch the API", "description": "..." }
    },
    {
      "name": "beta",
      "cwd": "~/work/project-b",
      "agent_type": "codex",
      "launch_args": ["--dangerously-bypass-approvals-and-sandbox"],
      "description": "Frontend client of A — consumes alpha's API.",
      "extra_prompt": "Project B is the client of A."
    }
  ]
}
EOF

my-team start                    # auto-discovers ./my-team.json
my-team status --team demo
my-team msg --team demo --to alpha --body "also write tests"
my-team add-task --team demo --worker beta --subject "Bump SDK" --description "..."
my-team shutdown --team demo
```

> **`description` vs `extra_prompt`** — both optional. `description` is a
> one-liner shown to *other* workers in the Team Roster, so a worker can
> judge whom to ask for help. `extra_prompt` is detailed instructions
> injected only into *that* worker's own prompt. If `description` is
> omitted, the roster falls back to the first line of `extra_prompt`.

## Worker launch flags

Each worker's `launch_args` (optional `string[]`) is appended verbatim to the
CLI binary invocation. my-team does not interpret the flags — it forwards them
as-is to the underlying CLI.

### ⚠️ Each token is a separate array element

JSON array semantics: every argv token (flag name, flag value, option) **must
be its own string in the array**. A single string containing spaces is passed
as a single argv element, which most CLIs will reject as "unknown argument".

```jsonc
// ✅ correct — tokens split
"launch_args": ["--ask-for-approval", "never", "-s", "workspace-write"]

// ❌ wrong — codex will fail with "unexpected argument"
"launch_args": ["--ask-for-approval never -s workspace-write"]
```

### Common configurations

| agent_type | launch_args (JSON array) | effect |
|---|---|---|
| `claude` | `["--dangerously-skip-permissions"]` | bypass all permission checks |
| `claude` | `["--permission-mode", "bypassPermissions"]` | same effect via mode selector |
| `codex` | `["--dangerously-bypass-approvals-and-sandbox"]` | skip both approval prompts AND sandbox boundary (extreme) |
| `codex` | `["--ask-for-approval", "never", "-s", "workspace-write"]` | skip approval prompts but keep sandbox at workspace-write (moderate) |

`start` prints a stderr warning when any `--dangerously-*` flag is detected,
but does **not** block the launch. The user owns the risk.

Full example:

```jsonc
{
  "name": "alpha",
  "agent_type": "claude",
  "launch_args": ["--dangerously-skip-permissions"]
}
```

### Role-based recommended configurations

Workers communicate via mailbox files (`my-team api send-message`) and may
need to read peer workers' project files. Permission prompts on each Bash
or file-access tool call are the single most common cause of "worker can't
send message" or "worker can't read peer's file". Pick a configuration
based on the worker's role:

#### A. Autonomous collaboration (user observes panes, does not intervene)

Workers freely message each other and read/write peer cwd files. User
watches panes but does not respond to prompts.

```jsonc
// claude worker — full bypass
{ "name": "writer", "agent_type": "claude",
  "launch_args": ["--dangerously-skip-permissions"] }

// codex worker — both approval prompts AND sandbox disabled
{ "name": "builder", "agent_type": "codex",
  "launch_args": ["--dangerously-bypass-approvals-and-sandbox"] }
```

When to pick: long autonomous work, model-to-model handoff, you trust
the workers and want minimum friction.

Risk: a worker may accidentally damage another worker's files or run a
destructive command. The user owns the risk.

#### B. Reviewer + autonomous writer (role separation)

Writer workers run fully autonomous; reviewer/critic workers are
read-only so they cannot accidentally edit code.

```jsonc
// writer — autonomous
{ "name": "writer", "agent_type": "claude",
  "launch_args": ["--dangerously-skip-permissions"] }

// reviewer — read-only sandbox: can read every peer cwd, cannot write
// anywhere. Use codex; claude has no clean single-flag equivalent.
{ "name": "reviewer", "agent_type": "codex",
  "launch_args": ["-s", "read-only"] }
```

When to pick: code review, security audit, fact-checking — you want a
worker that physically cannot edit files but can still inspect peer
output and reply via mailbox.

#### C. Supervised mode (user reviews every risky operation)

No bypass flags. The CLI's native permission prompt fires for every
Bash call, file edit, and cross-cwd access. The user must respond in
the pane.

```jsonc
{ "name": "alpha", "agent_type": "claude", "launch_args": [] }
{ "name": "beta",  "agent_type": "codex",
  "launch_args": ["-s", "workspace-write"] }
```

When to pick: production-touching work, irreversible operations
(database migrations, deploys), or while learning what a new worker
will actually do. High user attention required.

> **How a worker receives messages**: a peer's `send-message` writes to
> your `mailbox/<you>.json` and fires a best-effort tmux trigger. The
> trigger can be lost (busy pane, confirm prompt). So workers also
> **self-poll** their mailbox with `api mailbox-list` at the end of each
> work cycle, and mark consumed messages with `api mailbox-mark-delivered`
> — a lost trigger no longer means a lost message.
>
> The remaining friction is **cross-cwd file access** for the file-sharing
> pattern (write big content to a file, send the path via mailbox). For
> that pattern, mode A or B is required; mode C will prompt every single
> peer read.
>
> Known limitation (see `PLAN.md` §6 K1): a busy-pane trigger may be
> falsely reported as delivered. The message still reaches the mailbox
> file, so self-poll recovers it — only immediacy is lost.
>
> Mailbox files use an unlocked read-modify-write. This is safe under the
> current model (a single human drives commands serially — no concurrent
> writers). It only becomes a race once workers orchestrate each other;
> harden it (atomic write / JSONL) before reaching that stage.

## Commands

| Command | Purpose |
|---------|---------|
| `start` | Boot a team from config (or inline `--worker name:agent:cwd`) |
| `status` | Show team / workers / tasks |
| `msg` | Free-form inbox message to one worker |
| `add-task` | Register a tracked task and notify the worker |
| `shutdown` | Terminate a team |
| `api …` | Internal API used by worker LLMs (do not call manually) |

Run `my-team <cmd> --help` for full options.

## State layout

```
~/.my-team/sessions/<team>/
├── manifest.json
├── tasks/<id>.json
├── workers/<name>/
│   ├── AGENTS.md          # per-worker system prompt overlay (reused from OMC)
│   ├── inbox.md           # free-form lead → worker
│   ├── status.json
│   └── heartbeat.json
├── mailbox/<name>.json    # worker → worker direct messages
└── leader/inbox.md        # worker → leader notifications
```

## What's borrowed from OMC

See `PLAN.md` Appendix A. Briefly:

- **Borrowed verbatim** — `tmux-utils.js`, `tmux-comm.js` (low-level), `fs-utils.js`, `inbox-outbox.js`, `worker-bootstrap.js`, `team-name.js`, `state-paths.js`
- **Modified** — `tmux-session.js` (per-worker cwd in `createTeamSession`), `task-ops.js` (claim_token removed)
- **Stubbed** — `prompt-helpers.js`, `cli-rendering.js`, `state-root.js`
- **Dropped** — `dispatch-queue.js`, `mcp-comm.js` (high-level), `git-worktree.js`, OMC governance modules

## License

MIT. See `LICENSE` for the OMC attribution.
