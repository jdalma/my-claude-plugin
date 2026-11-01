#!/bin/sh
# Print "my turn N" for tmux status-right; prints nothing when the board is down or N is 0.
# Usage in ~/.tmux.conf:  set -g status-right '#(~/path/to/tmux-badge.sh) %H:%M'
port="${CONTROL_TOWER_PORT:-47700}"
n=$(curl -s -m 1 "http://127.0.0.1:${port}/state.json" |
    jq '[.teams[].workers[], .loose[]] | map(select(.my_turn)) | length' 2>/dev/null)
[ -n "$n" ] && [ "$n" -gt 0 ] && printf 'my turn %s' "$n"
exit 0
