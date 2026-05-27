---
name: my-team
description: Multi-project tmux worker orchestration. Spawn N CLI workers in tmux panes, each at its own project cwd, with shared mailbox for collaboration. Use when several distinct projects need to be edited and discussed by separate workers in one coordinated session.
aliases: []
---

# my-team Skill

Spawn coordinated CLI workers (claude / codex / gemini / cursor) across multiple project directories. Adapts the OMC `team` tmux pane mechanism, lifts its single-cwd constraint, and keeps mailbox-based worker-to-worker communication.

## ⚠️ Prerequisite — CLI 설치 확인

이 스킬은 `my-team` CLI 바이너리(`tools/my-team` npm 패키지)를 호출한다. PATH에 없으면 동작하지 않는다.

```bash
command -v my-team  # 없으면 → 사용자에게 안내
```

미설치 상태이면 작업 시작 전에 사용자에게 안내한다:

> `my-team` CLI가 PATH에 없습니다. `/my-team-install`을 먼저 호출해서 설치한 뒤 다시 시도해주세요.

자동으로 install을 호출하지 마라. 사용자가 명시적으로 `/my-team-install`을 실행한 뒤 본 스킬을 다시 호출하는 흐름.

## Usage

```bash
# 1. Write a config file (my-team.json or team.json)
cat > my-team.json <<'EOF'
{
  "team_name": "my-feature",
  "workers": [
    {
      "name": "backend",
      "cwd": "/Users/me/IdeaProjects/atiissu-backend",
      "agent_type": "claude",
      "description": "백엔드 담당 (peers가 보는 한 줄 역할)",
      "extra_prompt": "백엔드 담당. 첫 작업은 주문 API 추가 — POST /orders, 검증 규칙은 ..."
    },
    {
      "name": "order",
      "cwd": "/Users/me/IdeaProjects/iic-ucp-order",
      "agent_type": "codex",
      "description": "주문 도메인",
      "extra_prompt": "주문 도메인 담당. 첫 작업은 캐시 추가 — Redis로 ..."
    }
  ]
}
EOF

# 2. Boot
my-team start --config ./my-team.json

# 3. Inspect
my-team status --team my-feature
my-team monitor my-feature   # peer 메시지 실시간 tail

# 4. 도중에 워커한테 추가 지시 → 해당 워커의 tmux pane에 직접 타이핑
#    워커끼리는 my-team api send-message 호출 (워커 LLM이 AGENTS.md에 따라)

# 5. Shutdown
my-team shutdown --team my-feature
```

**도중 작업 지시**: `my-team msg` / `my-team add-task` 명령은 없다. 사용자가 워커한테 추가 일감을 줄 때는 그 워커의 tmux pane에 직접 입력한다. 워커끼리 일감을 위임할 때는 `my-team api send-message`로 peer 메시지를 보낸다.

## When to use vs OMC `team`

- **`/oh-my-claudecode:team`** — single repo, native Claude Code subagents
- **`/oh-my-claudecode:omc-teams`** — single repo cwd, external CLI workers
- **`my-team`** — **multiple unrelated repos**, external CLI workers, per-worker cwd

## Key differences from OMC

| Feature | OMC `omc team` | `my-team` |
|---------|----------------|-----------|
| Per-worker cwd | ❌ single cwd | ✅ each worker's `cwd` |
| Git worktree mgmt | optional `OMC_TEAM_WORKTREE_MODE` | ❌ (user-owned) |
| Task lifecycle (claim/transition) | full | ❌ removed; my-team tracks no tasks |
| User→worker channel | inbox.md + `omc team msg` | user types directly into the worker's pane |
| State root | `~/.claude/teams/` | `~/.my-team/sessions/<team>/` |
| CLI prefix | `omc team api ...` | `my-team api ...` |

## Worker AGENTS.md

Each worker gets a per-worker `AGENTS.md` overlay under `<state_root>/workers/<name>/AGENTS.md`. The worker's `extra_prompt` (its initial work brief) renders into the `## Role Context` section; peers see only the one-line `description` field via the `## Team Roster`.

## Communication channels

my-team은 **peer-to-peer 모델**이다. leader/orchestrator 워커도, task lifecycle도 없다. 채널은 두 개뿐이다.

| Channel | Surface | Notify |
|---------|---------|--------|
| User → worker | 해당 워커의 tmux pane (사용자가 직접 타이핑) | 즉시 (tmux stdin) |
| Worker ↔ worker | `mailbox/<w>.json` + `incoming-spool/<w>/` | worker calls `my-team api send-message`, recipient gets `new-message:<from>` tmux trigger |
| Worker → user | 해당 워커의 pane stdout | 사용자가 pane을 직접 본다 |

**금지된 경로** (워커 LLM이 위반하면 안 됨):
- 다른 워커의 pane에 `tmux send-keys`로 직접 입력 박기 — manifest의 pane id는 사용자의 모니터링용이지 워커간 제어 surface가 아니다.
- `my-team msg` 호출 — 이 명령은 제거됐다. 사용자→워커는 pane 직접 입력 한 가지뿐.

## Constraints

- 1–10 workers per team
- Worker name: `[a-zA-Z0-9-]+`
- `cwd`: absolute or `~`-prefixed (no relative paths)
- Same `team_name` cannot run twice (refused with AC-28 error)
- agent CLI must be installed on PATH (claude / codex / gemini / cursor-agent)

## Environment variables

| Var | Default | Effect |
|-----|---------|--------|
| `MY_TEAM_STATE_ROOT_BASE` | `~/.my-team/sessions` | base directory for sessions |
| `MY_TEAM_STATE_ROOT` | (set by `start`) | absolute state root for current invocation |
| `MY_TEAM_GRACE_MS` | `10000` | graceful shutdown wait |
| `MY_TEAM_NO_RC` | (unset) | if `1`, workers skip sourcing zshrc/bashrc |
| `MY_TEAM_SHELL_READY_TIMEOUT_MS` | `30000` | how long to wait for a worker CLI prompt |

See PLAN.md for the full 31-criterion acceptance set, OMC borrowing manifest, and design rationale.
