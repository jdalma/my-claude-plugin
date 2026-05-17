# my-team — 워커 통신 아키텍처

> 본 문서는 `tools/my-team` CLI가 워커끼리 어떻게 메시지를 주고받게 하는지의 내부 메커니즘을 정리한다. 사용자 가이드는 `README.md`, 설계 결정은 `PLAN.md`, 워커 부팅 프롬프트는 `worker-bootstrap.md`. 코드 변경 시 본 문서도 업데이트해야 한다.
>
> **작성**: 2026-05-13 · **갱신**: 2026-05-17 (식별자 일관성, monitor 자동 시작, sendToWorker robust 처리)
> **대상 코드**: `src/lib/tmux-comm.js`, `src/lib/events.js`, `src/commands/api/send-message.js`, `src/commands/{msg,add-task,monitor,start}.js`, `src/lib/tmux-session.js`
> **시각 다이어그램**: [`diagrams/communication-flow.excalidraw`](diagrams/communication-flow.excalidraw) — Excalidraw 앱 또는 VS Code `pomdtr.excalidraw-editor` 확장으로 열기. 5레인 액터 단면 (워커 A / mailbox/A.json / mailbox/B.json / 워커 B / tmux)으로 **요청→응답 1사이클**을 표현. 하단에 Q&A 4개로 "왜 메일박스가 워커마다 분리되나" / "응답은 어떻게 송신자에게 가나" / "여러 메시지가 쌓이면" / "수신 인지 메커니즘"을 상세 설명. 사용자 진입점은 §1 ASCII만 참고, body convention tokens는 §4.1 참조.

---

## 1. 한눈에 보는 데이터 흐름

```
                                ┌──────────────────────────────┐
                                │    사용자 (CLI 호출자)        │
                                └──────────────┬───────────────┘
                                               │
                ┌──────────────────────────────┼──────────────────────────────┐
                │                              │                              │
       my-team msg                  my-team add-task                  my-team monitor
       my-team api send-message         (워커 LLM이 호출)
                │                              │
                ▼                              ▼
   ╔═══════════════════════════════════════════════════════════════════════════╗
   ║                       파일 시스템 (공유 매체)                              ║
   ║  ~/.my-team/sessions/<team>/                                              ║
   ║  ├── manifest.json                  (팀 구성·pane_id 매핑)                 ║
   ║  ├── mailbox/                       ← 워커→워커 메시지 (수신자 소유)        ║
   ║  │   ├── alpha.json                                                       ║
   ║  │   └── beta.json                                                        ║
   ║  ├── workers/<name>/                                                      ║
   ║  │   └── inbox.md                   ← 사용자→워커 자유형                  ║
   ║  ├── tasks/<id>.json                ← 정형 작업 (추적 가능)                ║
   ║  └── events.jsonl                   ← 모든 send-message 통합 로그          ║
   ╚═══════════════════════════════════════════════════════════════════════════╝
                                               │
                                               │ (파일 쓰기 직후)
                                               ▼
                                ┌──────────────────────────────┐
                                │   tmux send-keys (트리거)     │
                                │   → 수신자 pane_id            │
                                │   → "check-inbox" 또는        │
                                │     "new-message:<from>"     │
                                └──────────────┬───────────────┘
                                               │
                                               ▼
                                ┌──────────────────────────────┐
                                │  워커 페인 (tmux + Claude CLI) │
                                │  - 자기 inbox.md 읽기         │
                                │  - 자기 mailbox/<name>.json   │
                                │    폴링 (LLM 자율)            │
                                └──────────────────────────────┘
```

---

## 2. 통신 4종 매트릭스

| # | 채널 | 누가 호출 | 어디로 쓰임 | tmux 트리거 | 추적 가능 |
|---|---|---|---|---|---|
| 1 | **사용자→워커 (자유형)** | `my-team msg --to A "..."` | `workers/A/inbox.md` (append) | `check-inbox` | ❌ |
| 2 | **사용자→워커 (정형)** | `my-team add-task --worker A ...` | `tasks/N.json` + `workers/A/inbox.md` 알림 | `new-task:N` | ✅ task 상태 머신 |
| 3 | **워커→워커** | `my-team api send-message` (워커 LLM 내부) | 수신자 `mailbox/B.json` (push) + `events.jsonl` | `new-message:<from>` | ✅ `message_id` |
| 4 | **broadcast** ⚠️ dead code | `queueBroadcastMessage` (정의는 `tmux-comm.js:100`, 호출처 0) | (호출되지 않음) | (호출되지 않음) | — |

**워커→사용자 보고는 별도 채널 없음**: peer-to-peer 모델에서 사용자는 각 워커 페인을 직접 관찰한다. 워커는 자기 페인 stdout에 직접 출력하거나 CLI의 normal 권한 prompt를 띄운다. OMC 차용 시 따라온 `leader-fixed` 채널은 v0.1에서 제거됐다 (`api send-message`가 `to_worker === 'leader-fixed'`이면 명시적 에러 반환).

### 2.1 식별자 일관성 — `config.workers[].name` 단일 source

워커를 가리키는 모든 라벨은 `config.workers[].name` 한 문자열에서 갈라져 나온다. 이 문자열은 5곳에서 동일하게 쓰이므로 화면-prompt-라우팅 사이의 모호성이 0이다.

| 사용처 | 코드 위치 | 의미 |
|---|---|---|
| `to_worker` API 인자 | `commands/api/send-message.js:19` | 메시지 라우팅 키 |
| mailbox 파일명 (`mailbox/<name>.json`) | `lib/state-paths.js:45` | 수신자 mailbox JSON |
| inbox.md 경로 (`workers/<name>/inbox.md`) | `lib/state-paths.js:40` | 사용자→워커 채널 |
| tmux pane title | `lib/tmux-session.js:281` `select-pane -T w.name` | 사용자가 화면에서 보는 라벨 |
| AGENTS.md Identity + Team Roster | `lib/worker-bootstrap.js:150, Team Roster 섹션` | 워커 LLM이 자기·peer 이름을 prompt로 학습 |

→ A 워커가 B에게 메시지를 보낼 때 `to_worker: "B"`로 쓰는 이름과 사용자가 화면 pane border에서 보는 `B`와 B 자신이 `MY_TEAM_WORKER` env로 가진 이름이 **반드시 동일**하다.

**Team Roster 자동 주입** (2026-05-15 추가, 커밋 `e5dffb4`): 부팅 시 `start.js`가 모든 워커의 `{name, agent_type, role}` 명단을 만들어 각 워커의 AGENTS.md에 `## Team Roster` 섹션으로 박는다. 자기 자신은 `(you)` 태그. 이전엔 워커 LLM이 다른 워커 이름을 미리 알 수 없어 사용자 메시지나 mailbox 수신으로만 학습 가능했지만, 이제 부팅 시점에 팀 전체 명단을 prompt로 가진다.

**Pane title 고정** (2026-05-15 추가, 같은 커밋): 워커 CLI(특히 claude는 진행 summary, codex는 cwd basename)가 OSC escape sequence로 pane title을 덮어쓰는 문제가 있었다. `applyTeamLayout`에서 `allow-rename off` + `automatic-rename off`를 window 단위로 설정하고, `waitForPaneReady` 직후 `select-pane -T <worker.name>`을 재실행하는 안전장치를 둬서 title이 항상 `name`으로 고정된다.

---

## 3. "쓰고 → 알리는" 2단계 패턴

모든 통신이 동일 패턴 (`tmux-comm.js:75-95`):

```
Step 1: WRITE
  목적지 파일 읽기 → 메시지 push → 파일 쓰기 (atomic)
       │
       ▼
Step 2: NOTIFY (tmux send-keys)
  tmux send-keys -t <pane_id> "<trigger>" Enter
       │
       ▼
Step 3: ACK (선택)
  성공 시 mailbox 항목에 notified_at 박기 → 다시 쓰기
```

트리거가 빠지면 워커는 LLM 자율 폴링 전까지 알 수 없다.

---

## 4. 메시지 스펙 — 채널별 정확한 JSON 구조

### 4.1 워커→워커 mailbox 항목 (`mailbox/<to>.json`)

가장 풍부하고 자주 쓰이는 형식:

```json
{
  "worker": "beta",
  "messages": [
    {
      "message_id": "1715587931918-x9k2lm",
      "from_worker": "alpha",
      "to_worker": "beta",
      "body": "POST /payments body schema 알려줘",
      "created_at": "2026-05-13T07:32:11.918Z",
      "notified_at": "2026-05-13T07:32:12.144Z"
    }
  ]
}
```

| 필드 | 타입 | 의미 |
|---|---|---|
| `message_id` | string | `${Date.now()}-${random6chars}` — 고유 ID |
| `from_worker` | string | 보낸 워커 이름 (`[a-zA-Z0-9-]+`) |
| `to_worker` | string | 받는 워커 이름 (= 파일 주인) |
| `body` | string | 메시지 본문 (길이 제한 없음, 줄바꿈 포함 가능) |
| `created_at` | ISO 8601 | 쓰기 시점 |
| `notified_at` | ISO 8601 / undefined | tmux 트리거 성공 시점. 실패하면 필드 자체가 없음 |

**파일 형식**: 워커 1명당 하나의 JSON 파일, `messages` 배열에 시간순 push.

**body 컨벤션 토큰** (API 미강제 — 워커 AGENTS.md가 동작 안내):

| 토큰 (body 첫머리) | 의미 | 수신 워커의 의무 |
|---|---|---|
| `[REQUIRES ACK]` | 도착 확인만 받고 싶음 | 짧은 ack 메시지 회신 |
| `[BLOCKING reply_within=<sec>]` | deadline 내 답변 필수, 송신자는 폴링 대기 | 다른 작업 멈추고 답변. 못 하면 `[BLOCKED reason=...]` 회신 |
| `[NONBLOCKING]` | fire-and-forget | 읽기·옵션 작업, 회신 X |
| (토큰 없음) | 기본 정보성 | 직접 질문이면 답, 아니면 읽기만 |

도구는 토큰을 해석하지 않는다. `worker-bootstrap.js`의 generateWorkerOverlay가 모든 워커 AGENTS.md에 같은 표를 박아 LLM 행동을 표준화한다. 송신 워커가 `[BLOCKING reply_within=30]` 보내면 본인이 5초 간격으로 자기 mailbox를 폴링하다가 deadline 도과 시 페인 stdout에 timeout 노트.

### 4.2 사용자→워커 inbox 항목 (`workers/<w>/inbox.md`)

마크다운 append 로그 — 메시지 ID 없음, 단순 추적용 텍스트:

```markdown


---
체크 부탁: A 프로젝트 PaymentService 분석해줘. 결제 흐름 그려달라.
_queued: 2026-05-13T07:32:11.918Z_


---
New task #3 assigned: 캐시 로직 추가
Read your AGENTS.md task list or run 'my-team api read-task ...' to inspect.
_queued: 2026-05-13T07:33:00.045Z_
```

각 entry 사이 `---` 구분자. 트리거는 별도 (`check-inbox` 또는 `new-task:N`).

### 4.3 정형 task (`tasks/<id>.json`)

구조화된 작업 단위:

```json
{
  "id": "3",
  "subject": "캐시 로직 추가",
  "description": "Redis 5분 TTL, key 패턴은 ...",
  "owner": "alpha",
  "status": "pending",
  "created_at": "2026-05-13T07:33:00.045Z",
  "updated_at": "2026-05-13T07:33:00.045Z"
}
```

| 필드 | 타입 | 의미 |
|---|---|---|
| `id` | string | 자동 증가 ("1", "2", ...) 또는 사용자 지정 |
| `subject` | string | 짧은 요약 |
| `description` | string | 상세 내용 |
| `owner` | string | 담당 워커 (또는 미할당) |
| `status` | enum | `pending` / `in_progress` / `completed` / `failed` / `blocked` |
| `created_at` / `updated_at` | ISO 8601 | 시점 |

**상태 전이**: 워커 LLM이 `my-team api transition-task-status`로 변경.

### 4.4 events.jsonl (통합 로그, monitor용)

한 줄당 한 이벤트의 JSONL:

```jsonl
{"ts":"2026-05-13T07:32:11.918Z","from":"alpha","to":"beta","body":"POST /payments body schema 알려줘"}
{"ts":"2026-05-13T07:32:13.045Z","from":"beta","to":"alpha","body":"{amount, currency, order_id}.\nPaymentRequestDto에 정의됨."}
{"ts":"2026-05-13T07:35:20.812Z","from":"charlie","to":"alpha","body":"통합 문서 작성 완료, 검토 부탁"}
```

| 필드 | 타입 | 의미 |
|---|---|---|
| `ts` | ISO 8601 | 이벤트 시각 |
| `from` | string | 보낸 워커 |
| `to` | string | 받는 워커 (팀의 워커 이름) |
| `body` | string | 메시지 본문 (mailbox와 동일) |

**append-only**: `my-team monitor`가 `fs.watch`로 follow.

**범위 제약**: 현재 send-message API만 events에 기록한다. task lifecycle(create/transition)은 의도적으로 미포함 (PLAN §monitor 결정 참조).

---

## 5. tmux 트리거 메시지 스펙

`sendTmuxTrigger(paneId, type, payload)`가 만드는 짧은 문자열 (`tmux-comm.js:47-58`):

| 트리거 타입 | payload | 실제 페인에 입력되는 문자열 | 의미 |
|---|---|---|---|
| `check-inbox` | (없음) | `check-inbox` | "자기 inbox.md 확인" |
| `new-message` | `<from-worker>` | `new-message:alpha` | "alpha가 보낸 mailbox 메시지 있음" |
| `new-task` | `<task-id>` | `new-task:3` | "task #3 새로 할당됨" |

**제약**: 200자 초과 거부 (`tmux-comm.js:49-52`). tmux `send-keys` 호출 후 `C-m` (Enter) 자동.

**전송 방식**: `tmux send-keys -t <pane_id> "<trigger>" Enter` — 워커 페인의 stdin에 평문 문자열 박음. 워커 LLM이 이걸 자연어 입력으로 받아 "trigger 메시지를 받았으니 자기 파일을 확인하라"고 해석.

### 5.1 `sendToWorker` robust 처리 (`tmux-session.js:394–435`)

단순 `send-keys`로는 워커가 busy 상태일 때 트리거가 흡수돼버린다. 그래서 `sendToWorker`는 다음 가드를 거친다:

1. **copy-mode 체크**: pane이 copy-mode면 즉시 false 반환 (사용자가 텍스트 선택 중이면 방해하지 않음)
2. **busy 감지**: `paneHasActiveTask`로 "esc to interrupt" / "background terminal running" 같은 신호를 찾음 → busy면 round 1에서 Tab 한 번 누른 뒤 Enter (Claude/Codex의 "interrupt and submit" 컨벤션)
3. **trust prompt 감지**: 첫 부팅의 "Do you trust the contents of this directory?" 다이얼로그가 떠 있으면 C-m 두 번으로 통과
4. **send → 6라운드 poll**: 메시지를 `-l --`(literal)로 입력 후, pane tail에 메시지가 그대로 남아있으면(=아직 안 먹힘) Enter 다시 보냄. 최대 6번 시도, 각 라운드 사이 짧은 sleep.
5. **200자 한계** (`tmux-comm.js:49–52`): 초과 시 거부. trigger는 짧아야 한다는 원칙 — 긴 내용은 파일에, trigger는 "이 파일 봐"만.

**원칙**: 알림은 best-effort. 실패해도 mailbox/inbox 파일은 이미 쓰여 있어 워커가 우연히 폴링하거나 다음 trigger에서 발견 가능. `notified_at` 필드의 부재가 "트리거 실패" 신호.

---

## 6. 핵심 호출 시퀀스 — 워커 A→B 한 사이클

```
[워커 A의 LLM 컨텍스트]
  Bash 도구로 호출:
  my-team api send-message --input '{
    "team_name":"demo","from_worker":"A","to_worker":"B",
    "body":"질문 텍스트"
  }' --json
                  │
                  ▼
[my-team CLI 프로세스 in A's pane shell context]
  send-message.js:
    1. loadManifest("demo") → state_root, B의 pane_id 조회
    2. recipient = workers.find(name="B")
    3. queueDirectMessage(team, A, B, body, B.pane_id, parentDir)
                                                 │
       ┌─────────────────────────────────────────┘
       ▼
   tmux-comm.js queueDirectMessage:
     a. readMailboxFile("B")          → mailbox 객체 또는 {messages:[]}
     b. message 객체 생성 (id/from/to/body/created_at)
     c. mailbox.messages.push(message)
     d. writeMailboxFile("B", mailbox)  → mailbox/B.json 저장
     e. sendTmuxTrigger(B.pane_id, "new-message", "A")
        → tmux send-keys -t %2 "new-message:A" Enter
     f. notified_at 갱신 → 다시 write
       │
       ▼
   send-message.js (continue):
     4. appendMessageEvent(state_root, {from:A, to:B, body})
        → events.jsonl에 한 줄 append
     5. return { ok: true, delivered_to: "B", message_id }
                  │
                  ▼
[워커 A의 LLM 컨텍스트]
  CLI 종료 → 종료 코드 0 → 성공 인지

[워커 B의 페인]
  stdin에 "new-message:A\n" 도착 → Claude CLI가 이걸 prompt로 인식
  → B의 LLM이 자율적으로:
    Bash 도구로 my-team api ... 호출
    또는 read JSON file ~/.my-team/sessions/demo/mailbox/B.json
  → messages 배열에서 새 메시지 발견 → 처리
```

---

## 7. 동시성·일관성 처리

| 측면 | 방식 |
|---|---|
| **mailbox 동시 쓰기** | 단일 프로세스 모델, 동시 write 가능성 낮음. atomic write 사용 (`writeFile` → 임시 파일 → rename) |
| **events.jsonl 동시 append** | OS 레벨 `appendFile`은 단일 라인 atomic (POSIX 보장, Linux/macOS) |
| **mailbox 읽기 중 쓰기 race** | 읽기는 mailbox 전체 JSON 파싱이라 부분 손상 시 fallback `{messages:[]}` 반환 (`tmux-comm.js:31-33`) |
| **claim_token** | OMC에 있던 task race 보호. my-team은 **제거** (워커=프로젝트 1:1이라 불필요). API는 noop 응답으로 호환 유지 (PLAN AC-31) |
| **트리거 실패** | `sendTmuxTrigger` false 반환 시에도 mailbox 파일은 이미 쓰여 있어 워커가 우연히 폴링하면 발견 |

---

## 8. 비활성 채널 — inbox-outbox.js

`src/lib/inbox-outbox.js`에 별도 JSONL 인박스/아웃박스가 있다:

- `state_root/teams/<team>/inbox/<worker>.jsonl` — JSONL byte-cursor 읽기 (`readNewInboxMessages`)
- `state_root/teams/<team>/outbox/<worker>.jsonl` — JSONL append 파일 (현재 사용처 없음)
- `state_root/teams/<team>/signals/<worker>.shutdown` — shutdown 신호 파일

OMC 원본에서 차용한 채널. **현재 my-team의 `msg`/`api send-message` 명령은 이 채널을 사용하지 않는다.** shutdown 시그널만 일부 활용 가능성. peer-to-peer 모델로 전환된 v0.1 이후에는 outbox가 향후 어떤 구조화 통신에 사용될지 미정 — 필요 시 별도 결정.

---

## 9. 빠진 기능 / 한계

1. **send-message 본문 길이 캡**: 코드에 없음. README는 "msg 명령 200자 초과 거부"라고 적었으나 실제 검증 로직 부재. mailbox에는 무제한 들어감.
2. **순서 보장**: tmux 트리거는 LLM 자율 처리 → 두 메시지가 빠르게 잇따라 도착하면 처리 순서는 LLM이 결정. mailbox 배열 자체는 시간순.
3. **수신 확인**: `notified_at`은 tmux send-keys 성공 여부만, 워커 LLM이 실제로 읽었는지는 보장 안 됨.
4. **deduplication**: `message_id`가 있지만 워커 LLM이 중복 처리하지 않게 막는 메커니즘 없음 (LLM이 알아서 처리).
5. **broadcast CLI 노출 없음**: `queueBroadcastMessage` 함수는 있지만 사용자가 호출할 명령은 PLAN §2에서 의도적으로 제거. 필요해지면 `my-team api broadcast` 추가 검토.

---

## 10. 변경 시 체크리스트

새 채널/메시지 타입 추가 시:

- [ ] 메시지 스펙 (§4) 표 갱신
- [ ] tmux 트리거 (§5) 표 갱신
- [ ] `events.jsonl`에 기록할지 결정 (모니터링 가시성 vs 노이즈)
- [ ] mailbox/inbox 컨벤션 (수신자 소유 vs append) 일치하는지
- [ ] 동시성 처리 (§7) 검토
- [ ] 본 문서 + PLAN.md + README.md 셋 다 갱신

---

## 11. Monitor 자동 시작 — detached 모드 한정 (`start.js`)

`my-team start`는 tmux 모드에 따라 leader pane 처리를 다르게 한다 (`commands/start.js:274–286`):

| 모드 | leader pane 정체 | monitor 처리 |
|---|---|---|
| **split-pane** | 사용자가 `my-team start`를 친 그 pane | 자동 시작 안 함 — 사용자 키보드를 잠가버리면 안 되니까. tip만 출력 |
| **dedicated-window** | 같은 tmux session의 새 window | tip만 출력 (사용자가 직접 실행) |
| **detached-session** | my-team이 새로 만든 tmux session의 leader pane | `tmux send-keys`로 `my-team monitor <team>`을 자동 입력 + Enter |

→ detached 모드에서는 사용자가 `tmux attach -t my-team-<team>-<ts>`로 붙는 순간 leader pane에 이미 monitor가 떠 있어 워커 트래픽이 즉시 흐른다. 이 동작은 2026-05-14 커밋 `3aec944`에서 추가됐다.

---

## 12. 참고

- 사용자 가이드: `tools/my-team/README.md`
- 설계 결정 + 31 acceptance criteria: `tools/my-team/PLAN.md`
- 워커 부팅 프롬프트 구조: `tools/my-team/docs/worker-bootstrap.md`
- 시각 다이어그램: `tools/my-team/docs/diagrams/communication-flow.excalidraw`
- 원본: oh-my-claude-sisyphus (MIT) — https://github.com/Yeachan-Heo/oh-my-claudecode
- 관련 스킬: `plugins/workflow/skills/my-team/SKILL.md`, `plugins/workflow/skills/my-team-install/SKILL.md`
