# my-team — 워커 부트스트랩 프롬프트 / 강제 지시

> 본 문서는 `my-team start`가 각 워커 CLI(claude/codex/gemini/cursor)에게 어떤 "최초 프롬프트와 강제 지시"를 주입하는지 정리한다. 사용자 가이드는 `README.md`, 통신 메커니즘은 [`architecture.md`](architecture.md), 초기 설계 의도는 `PLAN.md`.
>
> **현재 모델 (옵션 B 컷오버 이후)** — 워커는 부팅 시 단 하나의 instruction surface만 받는다: **`AGENTS.md` 오버레이**. 그 외에 옛 시점의 `inbox.md` 첫 작업 지시서, mandatory task lifecycle workflow, `check-inbox` 트리거는 모두 제거됐다.
>
> **대상 코드**: `src/lib/worker-bootstrap.js`, `src/lib/prompt-helpers.js`, `src/commands/start.js`
>
> **관련 다이어그램**: peer 메시지 흐름의 현행 시각 자료는 [`worker-message-flow.html`](worker-message-flow.html)(브라우저로 열기). [`diagrams/communication-flow.excalidraw`](diagrams/communication-flow.excalidraw)는 옵션 B 이전(inbox.md 시대)을 묘사한다 — peer mailbox 사이클 부분만 그대로 유효한 구버전.

---

## 1. 한눈에 보는 부팅 흐름

```
my-team start --config my-team.json
        │
        ▼
[1] config 검증 (workers[].task 필드 발견 시 hard-reject)
        │
        ▼
[2] tmux 세션 + 워커당 pane 생성 (per-worker cwd)
        │
        ▼
[3] 워커마다:
      a. 상태 디렉터리 ensure
      b. AGENTS.md 오버레이 생성 → workers/<name>/AGENTS.md
      c. 워커 CLI를 그 pane에서 spawn (--dangerously-* flags 포함)
      d. pane title을 워커 이름으로 박음 (@worker_name + select-pane -T)
        │
        ▼
[4] 모든 pane이 ready (CLI prompt 등장) 대기
        │
        ▼
[5] 각 pane에 시작 안내 한 줄 전송:
    "Team is live. Follow <AGENTS.md path> for the peer protocol;
     wait for user input in this pane or peer messages in your mailbox."
        │
        ▼
[6] manifest.json persist + detached 모드면 host pane에 monitor 자동 실행
```

부팅 후 워커는 **idle 상태**로 대기한다. 사용자가 그 pane에 입력하거나 peer가 `api send-message`로 메시지를 보낼 때까지 자발적으로 일하지 않는다.

## 2. `AGENTS.md` 오버레이 (`generateWorkerOverlay`)

워커별 `workers/<name>/AGENTS.md` 파일로 작성된다. 워커 CLI는 자기 cwd의 AGENTS.md를 자동으로 읽어 시스템 프롬프트로 사용한다 (claude/codex/gemini/cursor 모두 동일 컨벤션).

### 골격 구성 요소

| 섹션 | 내용 |
|------|------|
| `# Team Worker Protocol` (헤더) | peer-to-peer 모델 한 줄 선언 + user는 pane으로, peer는 mailbox로 본다 |
| `## Identity` | team_name, worker name, agent_type, `OMC_TEAM_WORKER` env |
| `## Team Roster` | 모든 워커 한 줄씩: `- **name** [agent_type] — role`. role은 config의 `description` (없으면 `extra_prompt` 첫 줄) |
| `## Liveness` | `status.json` / `heartbeat.json` 갱신 안내 |
| `## Message Protocol` | **hard rule**: peer 통신은 오직 `api send-message`. `tmux send-keys` 금지, `my-team msg` 금지 |
| `## Message Protocol > Talk to other workers via CLI API` | 6개 명령 한 줄씩 (send-message 1-way / send-message expects_reply / 답장 / mailbox-list / mark-delivered / archive-lookup) |
| `### All worker-to-worker messaging is ASYNCHRONOUS` | 절대 블로킹하지 말라는 원칙 |
| `### Message correlation` | message_id / reply_to / sent_pending 메커니즘 설명 |
| `### MANDATORY — Mailbox self-poll discipline` | 사이클 끝마다 + new-message 트리거 받을 때 mailbox-list, 처리 후 mark-delivered |
| `### Handling a received message — reply_to resolution order` | sent_pending hit → archive-lookup 순서 |
| `### When you send a message that needs an answer` | expects_reply=true 후 다른 일 계속 |
| `### Broadcast caveat` | 1:1만 지원 |
| `## Shutdown Protocol` | shutdown sentinel 받으면 shutdown-ack.json 쓰고 exit |
| `## Rules` | 6가지 금지 룰 (아래) |
| Agent-type guidance | claude/codex/gemini/cursor 별 추가 룰 |
| `## Role Context` | config의 `extra_prompt`가 그대로 들어감 (없으면 생략) |

### 금지 목록 (`## Rules`)

```
- Do NOT edit files outside the scope described in your ## Role Context brief
- Do NOT spawn sub-agents. Complete work in this worker session only.
- Do NOT create tmux panes/sessions.
- Do NOT type into another worker's pane via tmux send-keys / tmux send-text /
  any pane-targeting tmux command. The mailbox is the ONLY peer channel.
- Do NOT call `my-team msg` — that command was removed. user→worker is the user
  typing directly into your pane; worker→worker is `my-team api send-message`.
- Do NOT run team spawning/orchestration commands (`my-team start` etc.).
- Trust asynchrony: when you need an answer from a peer, send with
  expects_reply=true and continue your own work. Never invent a "faster path"
  that pushes text directly into a peer's pane.
```

이 가드 두 줄(`tmux send-keys 금지` + `my-team msg 금지`)은 **실제 사고 대응이다** — 2026-05-27 cdc-feature 세션에서 워커 LLM이 두 우회 경로를 모두 사용한 archive 증거가 있다.

### 에이전트 타입별 가이드 (요약)

| agent_type | 추가 룰 |
|------------|---------|
| **claude** | "Role Context의 작업 브리프에 집중. 위험 명령 전 native permission prompt로 사용자 확인" |
| **codex** | "짧고 명시적인 `api ... --json` 호출 + 실패 시 stderr 그대로 사용자에게 surface" |
| **gemini** | "작은 verifiable 증분 + commit-sized scope" |
| **cursor** | "REPL이라 /exit 절대 하지 말 것" |

옵션 B 이전 가이드에 있던 "exit 전 transition-task-status 호출" 의무는 제거됐다 (task lifecycle 자체가 없음).

## 3. `extra_prompt` — 워커의 첫 작업 브리프

옵션 B에서 `workers[].task.{subject,description}` 필드는 제거되고 모든 부팅 시 작업 지시가 **`workers[].extra_prompt`** 로 일원화됐다.

```jsonc
{
  "name": "alpha",
  "agent_type": "claude",
  "description": "Backend API owner — peers see this one-liner",
  "extra_prompt": "Project A is the backend. First job: POST /orders with validation rules in §3 of the spec. Owner: alpha."
}
```

- `description` (옵션) — 한 줄. peer의 AGENTS.md `## Team Roster`에 노출. 없으면 `extra_prompt` 첫 줄로 fallback.
- `extra_prompt` (옵션) — 자유 길이. 본인 AGENTS.md의 `## Role Context` 섹션에 그대로 들어감. 첫 작업 지시 + 도메인 컨텍스트 + 제약 등 무엇이든.

`extra_prompt_file`로 외부 파일에서 읽을 수도 있다 (parser는 둘 다 있으면 inline `extra_prompt`를 쓰고 경고).

## 4. 환경 변수 주입 (`start.js`)

워커 CLI는 다음 env로 spawn된다:

| 변수 | 값 | 용도 |
|------|-----|------|
| `MY_TEAM_WORKER` | `<team>/<name>` | 자기 정체성 |
| `MY_TEAM_STATE_ROOT` | 절대 경로 | 상태 디렉토리 위치 (state-paths.js가 사용) |
| `OMC_TEAM_WORKER` | `<team>/<name>` | OMC 호환 (워커 LLM이 자기가 my-team 워커임을 안다) |
| `...config.workers[].env` | 사용자 지정 | 워커별 추가 env (DB URL, API token 등) |

## 5. Pane title 고정 (`start.js` + `tmux-session.js`)

워커 CLI는 OSC title sequence를 계속 emit하므로 일반 `select-pane -T`로 박은 라벨이 곧 덮어쓰여진다. 그래서 pane-scoped user option `@worker_name`을 별도로 박고, pane-border-format이 이걸 우선 표시하도록 설정한다 (`tmux-session.js`의 `createTeamSession`). pane title은 cosmetic fallback.

→ 사용자가 그리드에서 보는 라벨이 항상 `config.workers[].name`이다.

## 6. 부팅 시 시작 안내 (`start.js`)

각 워커 pane이 ready 상태에 들어간 후, start.js는 짧은 안내 한 줄을 send-keys로 보낸다:

```
Team is live. Follow <state_root>/workers/<name>/AGENTS.md for the peer protocol;
wait for user input in this pane or peer messages in your mailbox.
```

이걸 받은 워커 LLM은 자기 AGENTS.md를 (이미 시스템 프롬프트로 갖고 있지만) 한 번 더 읽고 idle 진입한다.

옵션 B 이전에는 `generateTriggerMessage`가 `Read <inbox.md path>, execute now, report concrete progress.`를 보냈지만, inbox.md 폐기 후 그 헬퍼도 함께 제거됐다.

## 7. 사용자가 자유롭게 주입할 수 있는 채널

| 채널 | 방법 | 영속성 |
|------|------|--------|
| **부팅 시 작업 브리프** | `config.workers[].extra_prompt` (또는 `extra_prompt_file`) | AGENTS.md `## Role Context`로 영구 |
| **도중 추가 지시** | 사용자가 그 워커의 tmux pane에 직접 타이핑 | tmux scrollback only |
| **peer 알림** | 워커끼리 `api send-message` (워커 LLM이 호출) | mailbox + archive + events.jsonl |

옵션 B 이전에 있던 `my-team msg`, `my-team add-task`, `workers/<w>/inbox.md`는 더 이상 채널이 아니다.

## 8. 보안 — 프롬프트 인젝션 방어

- `description`, `extra_prompt`는 `sanitizePromptContent`로 정제된 뒤 AGENTS.md에 박힘 (마크다운 escape + 길이 제한).
- 사용자가 워커 pane에 직접 타이핑하는 텍스트는 신뢰 채널 (사용자가 곧 운영자).
- peer 메시지 body는 정제하지 않는다 — 송수신 워커 모두 같은 권한 수준이라는 가정. 악성 peer 시나리오는 my-team의 위협 모델 밖.

## 9. 요약 표

| 레이어 | 파일 | 누가 작성 | 워커가 언제 읽나 |
|--------|------|-----------|------------------|
| ① AGENTS.md 오버레이 | `workers/<name>/AGENTS.md` | start.js가 부팅 시 generate | 부팅 시 1회 (시스템 프롬프트) |
| ② Role Context (extra_prompt) | AGENTS.md `## Role Context` | 사용자의 config | ①에 포함되어 부팅 시 1회 |
| ③ peer 메시지 | `mailbox/<name>.json` | peer가 `api send-message` | new-message 트리거 또는 사이클 끝마다 폴링 |
| ④ 사용자 자유 입력 | 워커 pane stdin | 사용자가 직접 타이핑 | 즉시 (tmux 키 입력) |

옵션 B 이전 레이어 ②(`inbox.md`)와 mandatory task lifecycle workflow는 제거됐다.

## 10. 변경 시 체크리스트

- AGENTS.md overlay 섹션 추가/제거 → §2 표 업데이트
- 새 금지 룰 → §2 "금지 목록" 갱신 + 사고 사례 출처 추가 (LLM이 룰의 *이유*를 알면 더 잘 지킨다)
- 에이전트별 가이드 변경 → §2 "에이전트 타입별 가이드" 표
- start.js의 시작 안내 문구 변경 → §6
- env 변수 추가/변경 → §4
