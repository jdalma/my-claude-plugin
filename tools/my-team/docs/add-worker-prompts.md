# my-team — `add-worker`로 합류하는 워커에게 주입되는 프롬프트

> 본 문서는 `my-team add-worker`로 세션 도중 합류하는 워커(티켓 위임 워커, 교대 후임 워커)가 **어떤 프롬프트를, 어떤 순서로, 누구에게서** 받는지 정리한다. `start`로 뜨는 초기 워커의 부트스트랩은 [`worker-bootstrap.md`](worker-bootstrap.md), 통신 메커니즘은 [`architecture.md`](architecture.md).
>
> **대상 코드**: `src/commands/add-worker.js`, `src/lib/worker-bootstrap.js`, `src/lib/tmux-session.js`
>
> **작성 계기 (2026-09-15)**: 티켓 위임 워커가 스폰한 부모 워커에게 진행 상황을 매번 보고하는 현상. 원인은 프롬프트 누락이었고(§4), Rules에 Spawn protocol을 추가해 대응했다(§5).

---

## 1. 한눈에 보는 흐름

```
부모 워커(또는 사용자)가 add-worker 실행
   │
   ├─ ① AGENTS.md 파일 생성   ← 코드가 만드는 고정 규약 + 부모가 쓴 --extra-prompt
   ├─ ② CLI 부팅              ← 프롬프트 없음. env 변수만 세팅
   ├─ ③ 조인 인사 타이핑       ← "①을 읽고 피어들에게 인사해라"
   └─ ④ 티켓 send-message     ← 부모 LLM이 자유 작성. mailbox로 도착
```

핵심: **워커의 "헌법"은 ① AGENTS.md 파일이고, 이 파일은 시스템 프롬프트로 주입되지 않는다.** ③ 인사가 절대 경로를 알려주면 워커가 파일을 한 번 읽는다. 워커 CLI는 자기 `cwd`에서 부팅되는데 AGENTS.md는 `<state_root>/workers/<name>/`에 있어 CLI가 자동 로드하지 않기 때문이다 (`add-worker.js` Step 8 주석).

## 2. 네 개의 주입 표면

| # | 표면 | 만드는 주체 | 코드 위치 | 워커가 읽는 시점 |
|---|---|---|---|---|
| ① | AGENTS.md 오버레이 | 코드 (`generateWorkerOverlay`) + `--extra-prompt` | `worker-bootstrap.js` `generateWorkerOverlay`, `add-worker.js` Step 2 | ③ 인사를 받은 직후 1회 |
| ② | CLI 부팅 | 코드 (`spawnWorkerInPane`) | `tmux-session.js` `spawnWorkerInPane`, `add-worker.js` Step 4 | 프롬프트 없음 |
| ③ | 조인 인사 | 코드 (고정 문구) | `add-worker.js` Step 8 | 즉시 (pane에 타이핑) |
| ④ | 티켓 | 부모 워커 LLM | 부모의 `api send-message` 호출 | 다음 `mailbox-list` 폴링 |

### ② CLI 부팅에 붙는 env

```
MY_TEAM_WORKER=<team>/<name>
MY_TEAM_STATE_ROOT=<state_root>
OMC_TEAM_WORKER=<team>/<name>
```

`launch_args`는 명시한 `--launch-arg`가 있으면 그것, 없고 **부모 워커가 호출**했으면(`MY_TEAM_WORKER` env로 식별) 부모의 `launch_args`를 상속한다.

### ③ 조인 인사 문구

```
You just joined team '<team>'. First action: read <AGENTS.md 절대경로>
for the roster + peer protocol, then introduce yourself to every OTHER
worker via send-message with expects_reply, as that file describes.
```

`start`의 초기 워커는 대신 "Team is live. Follow <경로> ...; wait for user input ..."을 받고, 인사를 돌리지 않는다. add-worker 워커만 전원에게 `expects_reply` 인사를 보낸다.

## 3. ① AGENTS.md 오버레이 섹션과 렌더링 조건

| 섹션 | 내용 | 렌더링 조건 |
|---|---|---|
| Team Worker Protocol | "N명 중 한 명의 peer. 사용자는 pane에 직접 타이핑, 워커끼리는 mailbox" | 항상 |
| Identity | 팀명, 워커명, agent type, env | 항상 |
| Team Roster | 부팅 시점 팀원(이름·타입·한 줄 설명). "스냅샷이며 `mailbox-list`의 roster가 정본" | 항상 |
| Liveness | `status.json`(idle/working/blocked/done/failed), `heartbeat.json` | 항상 |
| Team Role: ORCHESTRATOR / WORKER | 위임 규율, "블록 시 질문 1통·완료 시 보고 1통", cross-team 게이트 | **`workerRole`이 non-null일 때만** |
| Message Protocol | send-message / mailbox-list / mark-delivered 예시, 비동기 원칙, reply_to 해석 순서, 자기 폴링 의무 | 항상 |
| Rules | 파일 범위, tmux 직접 조작 금지, 중첩 팀 금지, **Parallel work(스폰 규약)**, 피어 제거, 교대 | 항상 |
| Agent-Type Guidance | claude/codex/gemini/cursor별 팁 | 항상 (타입별 분기) |
| Role Context | `--extra-prompt` 원문 | extra-prompt 있을 때만 |

### `workerRole` 결정 규칙 (`add-worker.js`)

```js
const teamUsesRoles = manifest.workers.some((w) => w.role === 'orchestrator' || w.role === 'worker');
const workerRole = validated.role ?? (teamUsesRoles ? 'worker' : null);
```

- 팀에 role 선언 워커가 하나라도 있으면 새 워커는 `worker`(또는 `--role` 명시값).
- 없으면 `null` → Team Role 섹션이 통째로 빠지고, Message Protocol에 "There is no orchestrator or leader role in this team, every worker (including you) is a peer"가 렌더링된다.
- SKILL.md 사용 예시 설정에는 `role`이 없으므로 **기본은 빠지는 쪽**이다.

## 4. 분석: "부모에게 완료 시 1회만 보고"가 어디에도 없었던 이유

### 규칙이 존재하는 유일한 곳은 role 게이트 뒤

- `roleGuidance('worker')`: "Message your orchestrator ONLY (a) blocked 시 expects_reply 1통, (b) 완료 시 reply_to 최종 보고 1통. No progress updates, no acknowledgements."
- `roleGuidance('orchestrator')`: "Expect from each worker at most a question when blocked and one final report when done."
- 커밋 4faba0e가 추가한 문장이 정확히 이 둘이고, 둘 다 §3의 조건에 따라 peer 팀에서는 렌더링되지 않는다.
- role 팀이더라도 WORKER 섹션의 "your orchestrator(s)"는 `teamRole === 'orchestrator'` 목록이다. `role: worker`인 부모가 스폰하면 부모는 그 목록에 없다. **부모–자식 관계는 프롬프트 어디에도 모델링돼 있지 않다.**

### 오히려 잦은 메시징을 유도하던 문구 (peer 모드에서 그대로 적용)

| 위치 | 문구 | 효과 |
|---|---|---|
| ③ 조인 인사 | "introduce yourself to every OTHER worker via send-message with expects_reply" | 부팅 직후 N통 발신, 각 피어가 규칙("expects_reply면 답한다")에 따라 N통 회신 |
| Rules · Parallel work (변경 전) | "hand it a ticket via send-message and **coordinate with it directly**" | 지속 왕복 권장 |
| Team Roster | "When a sub-problem ... matches a peer's role, send that peer a message instead of solving it yourself" | 자식에게 부모는 로스터의 한 피어. 이 규칙으로 부모에게 질문 발신 |
| (부재) 부모 쪽 티켓 작성 규칙 | orchestrator 섹션의 "ticket form ... 'reply when done'"은 role 게이트 뒤 | peer 부모는 `--extra-prompt`·티켓에 "진행 상황 알려줘"를 자유롭게 넣을 수 있고 자식은 따른다 |

중립: 자기 폴링 규칙은 `mailbox-list` 호출 빈도이지 발신 빈도가 아니다. Agent-Type Guidance(claude)의 "surface progress via your normal stdout"은 stdout 대상이다.

## 5. 대응 (2026-09-15): Rules · Parallel work에 Spawn protocol 추가

`worker-bootstrap.js` Rules의 "Parallel work on one repo" 항목을 다음과 같이 바꿨다. role 여부와 무관하게 모든 워커 오버레이에 렌더링된다.

- 명령 예시에 `--extra-prompt "<the brief below>"` 추가.
- "coordinate with it directly" 삭제.
- **Spawn protocol** 3줄 신설:
  1. `--extra-prompt`에 반드시 넣을 문장을 고정 텍스트로 제공. 스폰한 워커 이름이 치환된다: "Spawned by `<me>`. Message `<me>` ONLY (a) when you need a decision to proceed — one message with expects_reply — or (b) when the ticket is done — one final report (reply_to the ticket). No progress updates, no acknowledgements: progress goes to your status file and your pane's stdout."
  2. 티켓 = goal + inputs(file paths) + deliverable + "reply to this message when done". `expects_reply`로 보내 최종 보고가 부모의 `sent_pending`에 잡히게 한다.
  3. 부모는 진행 상황을 묻지 않는다. status 파일 또는 `my-team status`로 읽는다.

렌더링 확인:

```bash
node -e "import('./src/lib/worker-bootstrap.js').then(m => {
  const out = m.generateWorkerOverlay({ teamName:'demo', workerName:'backend', agentType:'claude', bootstrapInstructions:'', instructionStateRoot:'/tmp/s', teamRoster:[] });
  const i = out.indexOf('**Parallel work on one repo**');
  console.log(out.slice(i, out.indexOf('**Retiring a peer', i)));
})"
```

### 남은 한계와 다음 단계 후보

자식 쪽 규칙은 **부모 LLM이 `--extra-prompt`에 지시문을 그대로 옮기는 데 의존**한다. 부모가 누락하면 자식은 이전과 같이 peer 규칙만 받는다. 재발하면 다음 중 하나로 올린다.

1. `add-worker`가 호출자를 `MY_TEAM_WORKER` env로 식별해 Role Context에 "Spawned by X ..." 문단을 **자동 삽입**. 부모 LLM에 의존하지 않아 확정적이지만, 오버레이 생성기에 parent 파라미터가 늘고 사용자가 직접 add-worker 한 경우와 구분이 필요하다.
2. 현재 WORKER role 규칙을 peer 모드에도 일반화("티켓을 준 피어에게는 blocked/done 시에만"). 검증된 문장을 재사용하지만 "no leader" 모델 정의와 충돌하는 표현이 생겨 문구 조정이 필요하다.

## 6. 누가 무엇을 통제하는가 (요약)

| 통제 주체 | 내용 |
|---|---|
| 코드가 고정 | ① 오버레이 전체(Role Context 제외), ③ 조인 인사, ② env |
| 부모 LLM이 작성 | ① Role Context(`--extra-prompt`), ④ 티켓, `--description` 한 줄 |
| 사용자 | pane 직접 타이핑 (tmux stdin) |

"부모에게 언제 보고할지"는 코드 고정 부분에 없었고, 지금은 코드 고정 부분(Rules)이 부모에게 "extra-prompt에 이 문장을 넣어라"고 지시하는 상태다.

## 7. 변경 시 체크리스트

- 오버레이 섹션 추가/제거 또는 렌더링 조건 변경 → §3 표
- `workerRole` 결정 로직 변경 → §3 코드 블록
- 조인 인사 문구 변경 → §2
- Spawn protocol 문구 변경 → §5 (렌더링 확인 명령으로 검증)
- 자동 삽입(§5 후보 1)으로 전환 시 → §4·§5·§6 전부 갱신
