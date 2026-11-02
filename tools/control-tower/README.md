# control-tower

One view of every my-team worker and every Claude Code / Codex session on this Mac: who is waiting for you, for how long, and a click to jump to that tmux pane.

Read-only except for moving focus. It never types into a pane, never closes a session, and never reads a my-team mailbox in a way that consumes it.

A Swift package for macOS 14+. `TowerCore` collects and judges, `TowerApp` is the menu bar app, and `tower-cli` prints the same data for scripts.

## Menu bar app

```bash
cd tools/control-tower
scripts/bundle-app.sh          # swift build -c release + ad-hoc signed .build/ControlTower.app
open .build/ControlTower.app
```

- Menu bar: an icon, plus N while N sessions are waiting for you. Collects every 5 s.
- Dropdown: the waiting sessions; click one to jump to it. Open Board (⌘B), Settings (⌘,), Quit (⌘Q).
- Board window: one column per live my-team team, then Claude Code and Codex sessions outside any team.
- Notification when a session turns into your turn (not for the first snapshot after launch). Click it to jump.
- Settings → Open at Login (off by default).

Notifications and Open at Login need the `.app` bundle; `swift run TowerApp` works without them.
The bundle is ad-hoc signed, not notarized: a personal tool built on this Mac.

A card is **your turn** when the agent finished its turn and has no unread peer mail, or a permission prompt is on screen. A worker my-team reports dead is never your turn.

Clicking a card:

- tmux session with an attached client: select the window and pane, then bring Ghostty forward.
- tmux session nobody is attached to: select the pane, then open a new Ghostty window running `tmux attach`.
- session outside tmux: bring its terminal app forward.

## tower-cli

```bash
swift build -c release --product tower-cli
.build/release/tower-cli --once | jq .   # one snapshot as JSON
.build/release/tower-cli --count         # number of sessions waiting for you; prints nothing at 0
```

## tmux status-right badge (optional)

Build `tower-cli` in release mode first (above), then:

```tmux
set -g status-right '#(~/IdeaProjects/my-claude-plugin/tools/control-tower/scripts/tmux-badge.sh) %H:%M'
```

Prints `my turn N` while N > 0. Prints nothing and exits 0 when N is 0 or `.build/release/tower-cli` is missing or fails.

## Where the data comes from

| Source | Used for |
|---|---|
| `my-team status --all --json` | live teams, workers, liveness, mail counts, status.json |
| `~/.claude/sessions/<pid>.json` | Claude pid, tmux pane, busy/idle, transcript |
| `sysctl` / libproc | processes, Codex processes and their open rollout files |
| `tmux list-panes` / `list-clients` / `capture-pane` | pane titles, attached sessions, permission prompts |
| transcript tails (last 200 KB) | last user / assistant message |

my-team is found on `PATH` first, then in the sibling `tools/my-team` checkout. Requires `tmux` and `node` (my-team runs on node).

## Test

```bash
swift test
```
