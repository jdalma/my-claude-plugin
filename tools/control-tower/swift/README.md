# Control Tower (Swift)

Native rewrite of `tools/control-tower`. `TowerCore` collects and judges; `TowerApp` is the menu bar app.

## Menu bar app

```bash
cd tools/control-tower/swift
scripts/bundle-app.sh          # swift build -c release + ad-hoc signed .build/ControlTower.app
open .build/ControlTower.app
```

- Menu bar: icon, plus N while N sessions are waiting for you. Collects every 5 s.
- Dropdown: the waiting sessions; click one to jump to it. Open Board (⌘B), Settings (⌘,), Quit (⌘Q).
- Board window: one column per live my-team team, then Claude Code and Codex sessions outside any team. Click a card to jump.
- Notification when a session turns into your turn (not for the first snapshot after launch). Click it to jump.
- Settings → Open at Login (off by default).

Notifications and Open at Login need the `.app` bundle; `swift run TowerApp` works without them.
The bundle is ad-hoc signed, not notarized: a personal tool built on this Mac.

Read-only except for moving focus: the app runs the argv arrays from `planFocus` (tmux `select-window`/`select-pane`, `open -a`) and nothing else.

## Test

```bash
swift test
```
