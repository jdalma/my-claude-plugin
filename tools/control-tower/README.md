# control-tower

One local board for every my-team worker and every Claude Code / Codex session on this Mac: who is waiting for you, for how long, and a click to jump to that tmux pane.

Read-only except for moving focus. It never types into a pane, never closes a session, and never reads a my-team mailbox in a way that consumes it.

## Run

```bash
cd tools/control-tower
npm link                       # optional: exposes `control-tower`
control-tower                  # http://127.0.0.1:47700, refresh every 5s
control-tower --port 47710 --interval 10
control-tower --once | jq .    # one snapshot as JSON, then exit
```

Requires Node ≥ 20, `tmux`, and macOS `ps` / `lsof`. No npm dependencies. my-team is called from the sibling `tools/my-team` directory, so it does not need to be installed globally.

## What the board shows

- One column per live my-team team, plus an **Outside** column for Claude / Codex sessions that are not team workers.
- A card rises to the top when it is **your turn**: the agent finished its turn and has no unread peer mail, or a permission prompt is on screen. A worker my-team reports dead is never your turn.
- Per card: status and how long it has been in it, cwd, unread spool / awaiting-reply counts, the worker's self-reported state, and the last assistant message.
- Click a card to jump there:
  - tmux session with an attached client: select the window and pane, then bring Ghostty forward.
  - tmux session nobody is attached to: select the pane, then open a new Ghostty window running `tmux attach`.
  - session outside tmux: bring its terminal app forward.

## Where the data comes from

| Source | Used for |
|---|---|
| `my-team status --all --json` | live teams, workers, liveness, mail counts, status.json |
| `~/.claude/sessions/<pid>.json` | Claude pid, tmux pane, busy/idle, transcript |
| `ps`, `lsof` | Codex processes and their rollout files |
| `tmux list-panes` / `list-clients` / `capture-pane` | pane titles, attached sessions, permission prompts |
| transcript tails (last 200 KB) | last user / assistant message |

## tmux status-right badge (optional)

```tmux
set -g status-right '#(~/IdeaProjects/my-claude-plugin/tools/control-tower/scripts/tmux-badge.sh) %H:%M'
```

Prints `my turn N` while the board is running and N > 0. Needs `curl` and `jq`. Set `CONTROL_TOWER_PORT` if you changed the port.

## Security

The server binds `127.0.0.1` only and rejects requests whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>`. `/switch` requires a random per-process token that only the served page contains, and accepts only handles present on the current board.

## Test

```bash
npm test
```
