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
      "extra_prompt": "Project A is the backend. First job: sketch the API — POST /orders, /users; validation rules in section 3 of the spec."
    },
    {
      "name": "beta",
      "cwd": "~/work/project-b",
      "agent_type": "codex",
      "launch_args": ["--dangerously-bypass-approvals-and-sandbox"],
      "description": "Frontend client of A — consumes alpha's API.",
      "extra_prompt": "Project B is the client of A. First job: bump SDK to v3 and adapt call sites."
    }
  ]
}
EOF

my-team start                    # auto-discovers ./my-team.json
my-team status --team demo
my-team monitor demo             # tail peer messages in real-time

# Mid-session: add a worker to the live team (new pane + registered as a peer).
my-team add-worker --team demo --name gamma --agent-type gemini --cwd ~/work/project-c

# To give an EXISTING worker a new task, type into its tmux pane directly.
# Workers reach each other via `my-team api send-message` (called from inside
# their AGENTS.md protocol).

my-team shutdown --team demo     # also clears state (backs up to <state_root>.bak)
```

> **Always shut down with `my-team shutdown`, not `tmux kill-session`.** Only
> `shutdown` clears the team's state. If you kill the tmux session directly,
> the state dir survives and re-running `start` with the same `team_name` will
> inherit the previous run's `events.jsonl` / `archive` / `mailbox`.

> **`description` vs `extra_prompt`** — both optional. `description` is a
> one-liner shown to *other* workers in the Team Roster, so a worker can
> judge whom to ask for help. `extra_prompt` carries the worker's own
> work brief (initial task plus any context) and renders into the
> `## Role Context` section of its AGENTS.md. If `description` is
> omitted, the roster falls back to the first line of `extra_prompt`.
>
> **There is no `task` field and no task lifecycle.** my-team used to track
> tasks via `add-task` / `claim-task` / `transition-task-status`; those were
> removed because the user observes every pane directly. Configs that still
> carry `workers[].task` are rejected with an explicit error — move the
> subject/description into `extra_prompt`.

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
| `status` | Show team and worker liveness |
| `add-worker` | Add one worker to a **running** team mid-session (`--team --name --agent-type --cwd`) — splits a new pane, registers it in `manifest.workers`, and notifies existing workers. Pass `--launch-arg` (repeatable) for permission-bypass flags; without them the added worker runs supervised and stalls on its first permission prompt |
| `monitor` | Tail peer messages in real-time |
| `shutdown` | Terminate a team **and clear its state** — backs up `state_root` to `<state_root>.bak` (one generation), then removes the original so re-running `start` with the same `team_name` starts clean (see "State cleanup" below) |
| `api send-message` | **[mutating]** Peer message — drops a spool file, appends sender archive, records `sent_pending` |
| `api mailbox-list` | **[mutating]** List unread inbox — *absorbs the incoming-spool into the mailbox first*. This absorption is the polling side effect: the name says "list" but it writes. Skip the poll and new messages are never absorbed |
| `api mailbox-mark-delivered` | **[mutating]** Mark consumed — moves the entry to the archive jsonl, removes it from the inbox |
| `api archive-lookup` | **[pure]** Look up an archived message by id — read-only |

> Internal peer-messaging API called by worker LLMs (do not call manually). The
> `[mutating]` / `[pure]` tag marks whether a call has a file-write side effect —
> `mailbox-list` is the subtle one: it *looks* read-only but absorbs the spool,
> which is exactly why the self-poll discipline works (and why skipping it loses
> messages). `status` and `monitor` are also pure (read / watch only).

Run `my-team <cmd> --help` for full options.

**Mid-session messaging** has no user→worker CLI command, by design. To give a
worker a new instruction, type into its tmux pane directly. The old `my-team
msg` / `my-team add-task` commands were removed when task lifecycle was dropped.

**Mid-session worker add**, by contrast, *is* a supported command: `my-team
add-worker` splits a new pane into the running team and registers the worker in
`manifest.workers` (which is all that's needed for peers to message it — `api
send-message` enforces roster membership per call). The new worker then
introduces itself: its startup notice tells it to `send-message` each existing
peer with `expects_reply=true`. Going through the mailbox (not a best-effort
in-pane tmux poke) means a busy peer still receives the greeting on its next
self-poll, and the ACK lets you see which peers haven't acknowledged the newcomer
yet (visibility — it does not auto-resend). Existing workers' `AGENTS.md` rosters
are static and are **not** rewritten (a running worker CLI already loaded its
`AGENTS.md` at launch, so a disk rewrite would not reach it); they reply to the
greeting by the `expects_reply` discipline already in their AGENTS.md.

## State layout

```
~/.my-team/sessions/<team>/
├── manifest.json
├── events.jsonl              # peer message audit log
├── workers/<name>/
│   ├── AGENTS.md             # per-worker system prompt overlay
│   ├── status.json
│   ├── heartbeat.json
│   └── shutdown-ack.json     # written on shutdown
├── mailbox/<name>.json       # peer mailbox (read by recipient)
├── incoming-spool/<name>/    # one file per inbound message (sender writes)
└── archive/<name>.jsonl      # processed messages, append-only
```

The state dir is keyed **only** by `team_name` (`~/.my-team/sessions/<team>`,
unless you set `state_root` explicitly). Two runs with the same `team_name`
therefore share this directory.

### State cleanup

`my-team shutdown` is what clears this directory. It renames `state_root` to
`<state_root>.bak` (keeping exactly one prior generation) and removes the
original, so the next `start` with the same `team_name` begins clean instead of
inheriting the previous run's `events.jsonl` / `archive` / `mailbox`.

- **Use `my-team shutdown`, not `tmux kill-session`.** Killing the tmux session
  directly runs none of this — the state dir survives and the next run overlaps.
- If the backup rename fails (e.g. across filesystems), `shutdown` keeps the
  state untouched and warns rather than deleting without a backup.
- **Known limitation:** `<state_root>.bak` for a team you never re-run lingers
  until you delete it manually. Only one generation is kept per team.
- This handles *sequential* reuse (shut down, then start again). Running two
  teams from one config **concurrently** is still unsupported — they would
  share one `state_root`; give each a distinct `team_name` for that.

## What's borrowed from OMC

See `PLAN.md` Appendix A. Briefly:

- **Borrowed verbatim** — `tmux-utils.js`, `tmux-comm.js` (low-level), `fs-utils.js`, `team-name.js`
- **Modified** — `tmux-session.js` (per-worker cwd in `createTeamSession`), `worker-bootstrap.js` (task lifecycle / inbox.md removed), `state-paths.js` (slimmed to mailbox/archive/spool only)
- **Stubbed** — `prompt-helpers.js`, `cli-rendering.js`, `state-root.js`
- **Dropped** — `dispatch-queue.js`, `mcp-comm.js` (high-level), `git-worktree.js`, `task-ops.js`, `inbox-outbox.js`, OMC governance modules

## License

MIT. See `LICENSE` for the OMC attribution.
