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
      "extra_prompt": "Project A is the backend.",
      "task": { "subject": "Sketch the API", "description": "..." }
    },
    {
      "name": "beta",
      "cwd": "~/work/project-b",
      "agent_type": "codex",
      "launch_args": ["--dangerously-bypass-approvals-and-sandbox"],
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
