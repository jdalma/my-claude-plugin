# my-team — 워커 부트스트랩 프롬프트 / 강제 지시

> 본 문서는 `my-team start`가 각 워커 CLI(claude/codex/gemini/cursor)에게 어떤 "최초 프롬프트와 강제 지시"를 주입하는지 정리한다. 사용자 가이드는 `README.md`, 통신 메커니즘은 `architecture.md`, 설계 결정은 `PLAN.md`. 코드 변경 시 본 문서도 업데이트해야 한다.
>
> **작성**: 2026-05-14
> **대상 코드**: `src/lib/worker-bootstrap.js`, `src/lib/prompt-helpers.js`, `src/commands/start.js`

---

## 1. 한눈에 보는 3-레이어 구조

워커 pane에는 그냥 단일 CLI(claude/codex/gemini/cursor)가 떠 있을 뿐이다. my-team은 그 CLI에게 다음 3겹을 깔아준다.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 워커 CLI (claude / codex / gemini / cursor)                                │
│                                                                            │
│   ① AGENTS.md 오버레이  — "먼저 읽어야 하는 규약 파일" (시스템 강제)        │
│        <state_root>/workers/<w>/AGENTS.md                                  │
│                                                                            │
│   ② inbox.md            — "첫 작업 지시서" (시스템 + task)                  │
│        <state_root>/workers/<w>/inbox.md                                   │
│                                                                            │
│   ③ 트리거 메시지        — pane stdin에 타이핑되는 한 줄 (시스템)           │
│        "Read <inbox-path>, work now, report progress."                    │
└────────────────────────────────────────────────────────────────────────────┘
```

부팅 흐름:

1. `start.js`가 워커별로 state dir 생성 → task 파일 기록 → AGENTS.md 작성 → inbox.md 작성
2. tmux pane에 CLI 바이너리 spawn (env 주입 포함)
3. pane이 ready 상태가 되면 트리거 메시지 1줄을 stdin으로 입력
4. CLI는 트리거 → inbox.md → AGENTS.md 순으로 읽고 mandatory workflow에 진입

---

## 2. 레이어 ① — `AGENTS.md` 오버레이 (`generateWorkerOverlay`)

`src/lib/worker-bootstrap.js:93` `generateWorkerOverlay()`가 만든다. **모든 워커에 동일한 골격**이 들어가고, 에이전트 타입별 미세 가이드와 사용자 `extra_prompt`만 가변이다.

### 골격 구성 요소

| 섹션 | 코드 위치 | 강제 내용 |
|---|---|---|
| FIRST ACTION | worker-bootstrap.js:128–132 | `mkdir -p ... && touch <sentinel>` 로 ready sentinel 작성 |
| MANDATORY WORKFLOW | worker-bootstrap.js:134–145 | ① `claim-task` → ② 작업 수행 → ③ `transition-task-status` (exit 전 필수) |
| Identity | worker-bootstrap.js:148–151 | team / worker / agent_type / `OMC_TEAM_WORKER` env |
| Team Roster | worker-bootstrap.js (Identity 다음) | 팀 내 모든 워커 이름·agent_type·역할(extra_prompt 첫 줄)을 나열. `to_worker` 값으로 어떤 이름을 써야 하는지 명시. 자기 자신은 `(you)` 표시 |
| Your Tasks | worker-bootstrap.js:97–101, 153–154 | config의 `task.subject` / `task.description`을 `sanitizePromptContent`로 정제 후 삽입 |
| Communication Protocol | worker-bootstrap.js:163–173 | inbox / status / heartbeat 파일 경로와 JSON 포맷 |
| Message Protocol | worker-bootstrap.js:179–182 | peer↔peer CLI: `send-message`, `mailbox-list`, `mailbox-mark-delivered` |
| Body convention tokens | worker-bootstrap.js:184–209 | `[REQUIRES ACK]` / `[BLOCKING reply_within=N]` / `[NONBLOCKING]` 컨벤션 + 수신 시 행동 규칙 |
| Shutdown Protocol | worker-bootstrap.js:211–217 | inbox에 shutdown 요청 → `shutdown-ack.json`에 accept/reject 기록 후 종료 |
| Rules (금지 목록) | worker-bootstrap.js:219–226 | 아래 표 참조 |
| Agent-Type Guidance | worker-bootstrap.js:57–91 | claude/codex/gemini/cursor 별 톤·제약 |
| BEFORE YOU EXIT | worker-bootstrap.js:230–231 | transition-task-status 재경고 |
| Role Context | worker-bootstrap.js:233 | 사용자가 준 `extra_prompt`를 마지막에 그대로 append |

### 금지 목록 (Rules 섹션)

- 태스크에 명시된 경로 밖 파일 수정 금지
- 태스크 파일에 lifecycle 필드(status/owner/result/error) 직접 쓰기 금지 — 반드시 CLI API 사용
- **서브에이전트 spawn 금지**
- **tmux split-window / new-session 금지**
- **`my-team` orchestration 명령 호출 금지** — 워커가 쓸 수 있는 control surface는 `my-team api ... --json` 뿐
- 블록되면 `status.json`에 `{state:"blocked", reason:"..."}` 기록 + pane stdout으로 사용자에게 알림

### 에이전트 타입별 가이드 (요약)

| agent_type | 핵심 추가 지시 |
|---|---|
| `claude` | "이 pane은 사용자가 직접 본다. 위험한 명령 전 native confirmation으로 사용자에게 묻고 답을 기다려라." |
| `codex` | "짧고 명시적인 `--json` 명령 선호. 실패 시 stderr를 그대로 노출. claim/transition은 **반드시** 호출." |
| `gemini` | "작고 검증 가능한 단위로 진행. claim/transition 누락 시 exit 금지." |
| `cursor` | "REPL이라 `/exit` 입력하지 마라. **reviewer/critic/security-review 역할은 받지 마라** — verdict-file write-and-exit가 REPL과 호환 안 됨. executor-style 태스크만 수락." |

### Body convention tokens 상세

API 레이어가 강제하지는 않는, **워커들이 따르기로 한 컨벤션**. 메시지 body 맨 앞에 토큰을 둔다.

| 토큰 | 송신자 의도 | 수신자 의무 |
|---|---|---|
| `[REQUIRES ACK]` | 받았다는 확인만 필요 | 짧은 ack 메시지 회신: `[ACK] re: <원본 앞 40자>` 후 자기 작업 계속 |
| `[BLOCKING reply_within=<sec>]` | 답을 받기 전엔 진행 못함 | 다른 작업 멈추고 substantive 회신. 데드라인 못 맞추면 `[BLOCKED reason=<short>]` 회신 |
| `[NONBLOCKING]` | fire-and-forget | 읽고 선택적 액션, 회신 없음 |
| (no token) | 정보성 | 읽고, 직접 질문이 있을 때만 회신 |

`[BLOCKING]` 송신 후에는 송신자도 **자기 mailbox를 ~5초 간격으로 폴링**하고, 데드라인 초과 시 pane stdout으로 timeout 노출.

---

## 3. 레이어 ② — `inbox.md` (첫 작업 지시서)

`src/commands/start.js:211–215`가 워커마다 작성.

**태스크 있을 때**:
```markdown
# Initial Inbox — <worker>

Your first task is #<id>: <subject>

Details:
<description>

Follow AGENTS.md protocol.
```

**태스크 없을 때**:
```markdown
# Initial Inbox — <worker>

No task assigned yet. Wait for instructions via mailbox or this inbox.
```

이후 lead → worker free-form 메시지(`my-team msg`)나 추가 task(`my-team add-task`)는 같은 inbox.md에 append 된다 (`appendToInbox`, worker-bootstrap.js:242–249).

---

## 4. 레이어 ③ — 트리거 메시지 (pane stdin에 타이핑)

`src/lib/worker-bootstrap.js:34` `generateTriggerMessage()` 가 만들어 `start.js:262–263`의 `sendToWorker`로 pane에 입력. state root에 따라 둘 중 하나:

- 기본 `.omc/state` 사용 시:
  > `Read <inbox-path>, execute now, report concrete progress.`
- 커스텀 state root (my-team 일반 케이스):
  > `Read <inbox-path>, work now, report progress.`

이게 워커가 부팅 직후 받는 **유일한 사람-말투 명령**이고, 이걸 받자마자 inbox.md → AGENTS.md 순으로 읽으며 mandatory workflow에 진입한다.

추가 변형:
- **mailbox 알림 트리거** (`generateMailboxTriggerMessage`, worker-bootstrap.js:48): peer 메시지 도착 시 `<n> new msg(s): check <mailbox-path>, act and report progress.` 가 pane에 타이핑됨.
- **prompt-mode 시작 프롬프트** (`generatePromptModeStartupPrompt`, worker-bootstrap.js:42): 일부 CLI의 `-p`/`--prompt` 모드용 단축 버전. `cliOutputContract`가 있으면 뒤에 append.

---

## 4-bis. Pane title 고정 (워커 이름 표시)

각 워커 pane의 위쪽 border에 표시되는 title은 `config.workers[].name`으로 고정된다 (`tmux-session.js:280–282`의 `select-pane -T <w.name>`). 워커 CLI(특히 `claude`는 진행 summary, `codex`는 cwd basename)는 OSC escape sequence로 자기 마음대로 title을 바꾸려 하지만, my-team이 두 단계로 차단한다.

1. **`applyTeamLayout`에서 OSC rename 무시** (`tmux-session.js:applyTeamLayout`):
   - `set-window-option -t <teamTarget> allow-rename off`
   - `set-window-option -t <teamTarget> automatic-rename off`
   - 효과: 워커 CLI가 OSC를 흘려도 tmux가 무시. window 단위 적용이라 사용자의 다른 tmux 세션에는 영향 없음.

2. **워커 ready 직후 title 재박기** (`start.js`, waitForPaneReady 직후):
   - 모든 워커가 ready 상태가 되면 `select-pane -T <worker.name>`을 한 번 더 호출
   - 부팅 도중 `allow-rename off`가 적용되기 전에 들어온 OSC가 title을 덮어썼을 경우의 안전장치

결과적으로 사용자가 보는 pane title은 항상 `config.workers[].name`이다. 단, **leader pane은 `"leader"`로 박혀 있음** (`tmux-session.js:288`).

---

## 5. 환경 변수 주입 (`start.js:233–238`)

각 워커 pane에 자동 주입:

| Var | 값 | 용도 |
|---|---|---|
| `MY_TEAM_WORKER` | `<team>/<worker>` | 워커 자기 식별 |
| `MY_TEAM_STATE_ROOT` | `<absolute>` | state 파일 위치 |
| `OMC_TEAM_WORKER` | `<team>/<worker>` | OMC 호환 |
| `config.workers[].env` | 사용자 정의 | 추가 env 전달 |

CLI 바이너리는 `start.js:39–44` `AGENT_CLI` 매핑으로 결정 (claude/codex/gemini/cursor-agent). `launch_args`에 `--dangerously-*` 플래그가 있으면 stderr로 경고만 하고 차단하지는 않는다 (start.js:222–227).

---

## 6. 사용자가 자유롭게 주입할 수 있는 채널

코드에 박힌 골격 외에, 사용자가 **config로 자유롭게 주입할 수 있는 영역은 두 곳뿐**이다.

| 채널 | config 필드 | 어디에 들어가나 |
|---|---|---|
| 역할 설명 | `workers[].extra_prompt` | AGENTS.md 끝 `## Role Context` 섹션 (worker-bootstrap.js:233) |
| 첫 태스크 | `workers[].task.{subject,description}` | inbox.md 본문 + AGENTS.md `## Your Tasks` (sanitize 후) |

그 외(claim/transition 강제, 서브에이전트·tmux·orchestration 금지, 메시지 토큰 컨벤션, 통신 프로토콜, agent-type 가이드 등)는 전부 코드에 박혀 있어 워커마다 동일하게 깔린다.

---

## 7. 보안 — 프롬프트 인젝션 방어

`src/lib/prompt-helpers.js:9` `sanitizePromptContent()`가 task subject/description을 AGENTS.md에 삽입하기 전에 두 가지를 한다:

1. 4000자 초과 시 잘라내고 surrogate pair 깨지지 않게 보정
2. `<system-instructions>`, `<system-reminder>`, `<TASK_SUBJECT>`, `<TASK_DESCRIPTION>`, `<INBOX_MESSAGE>` 같은 태그를 `[…]` 형태로 무력화

inbox에 append되는 lead 메시지(`appendToInbox`)는 `validateResolvedPath`로 path traversal만 막고 sanitize는 하지 않는다 — lead는 trusted 채널이라는 가정.

---

## 8. 요약 표

| 레이어 | 파일/채널 | 누가 결정 | 핵심 메시지 |
|---|---|---|---|
| ① 규약 | `<state_root>/workers/<w>/AGENTS.md` | 시스템 (고정 골격) + `extra_prompt` (사용자) | claim → work → transition, 통신/금지/종료 프로토콜 |
| ② 첫 지시 | `<state_root>/workers/<w>/inbox.md` | 시스템 + `task.subject/description` | "이게 네 첫 태스크다" |
| ③ 트리거 | tmux pane stdin (한 줄) | 시스템 | "inbox 읽고 지금 시작하라" |

자유 주입 영역: `extra_prompt`, `task.subject`, `task.description`. 나머지는 코드 고정.
