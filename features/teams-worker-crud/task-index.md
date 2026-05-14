---
feature_name: teams-worker-crud
created_by: handoff
created_at: 2026-05-14
plan_status: not_run
---

# teams-worker-crud

워커 CRUD 명령(`my-team remove`, `my-team add`)을 my-team CLI에 추가한다. 사용자가 부팅 시점에 잘못 박은 cwd·agent_type 등을 정정하기 위해 팀 전체를 shutdown·재부팅하지 않고도 일부 워커만 교체 가능하게 한다.

## Slices

> /plan 미실행. 슬라이스로 분해하려면 다음 세션에서 `/plan`을 호출하라 (4번째 옵션 `fill`로 Slices·Decisions 채움).

## TODO

- [ ] 다음 세션에서 `/takeover`로 인계 검증 후 `/plan fill`로 slice 채우기
- [ ] §결정 필요 사항 4건(섹션 아래)에 대한 사용자 결정 받기
- [ ] `commands/remove.js` 신규 (~80줄): manifest 항목 제거 + tmux kill-pane + 파일 정리(정책 결정 필요) + tiled 재적용
- [ ] `commands/add.js` 신규 (~120줄): start.js의 단일-워커 spawn 로직 재사용해 새 워커 추가 + manifest 갱신
- [ ] `commands/start.js` 리팩토링 (~30줄): 단일 워커 spawn 로직을 add.js와 공유 가능한 함수로 추출
- [ ] `cli.js` 라우팅 추가 (~10줄): remove / add 두 명령 등록
- [ ] README.md 갱신: remove/add 명령 사용법 + 결정 사항 명시
- [ ] `tools/my-team/docs/architecture.md` 갱신: 통신 5종 매트릭스에 워커 교체가 미치는 영향 (mailbox/tasks orphan 처리 등)
- [ ] **`worker-bootstrap.js`에서 leader-fixed 의존 표현 7곳 제거 (peer-to-peer 모델로 정합화)** — 아래 §leader-fixed 자취 참조

## Decisions / Traps (수명 긴 메모)

### 결정 필요 — 4건 (다음 세션 진입 시 사용자에게 확인)

- [pending][plan] **(a) remove 시 mailbox/tasks 처리 정책** — 세 옵션 중 하나 결정:
  - α: 함께 삭제 (깨끗한 제거)
  - β: 보존 기본, `--purge` 줘야 삭제
  - γ: 항상 보존, `--purge` 줘야 삭제
  - 영향: 같은 이름 재사용 시 새 워커 LLM이 옛 메시지를 보게 되는 위험 vs 데이터 보존 가치

- [pending][plan] **(b) 같은 이름 재사용 허용 여부** — 새 워커가 옛 워커 이름을 재사용하면 mailbox/inbox에 옛 메시지가 그대로 보임. 경고 + y/n 확인 vs 즉시 거부 vs 무조건 허용.

- [pending][plan] **(c) Orphan task 처리** — 워커 A가 워커 B에 task 위임한 상태에서 B remove. `tasks/N.json`의 `owner: B`는 어떻게? 세 옵션:
  - (i) 그대로 둠 (owner: B 유지, 처리할 워커 없음)
  - (ii) 자동 `failed` 상태 전이
  - (iii) 사용자에게 새 owner 묻기

- [pending][plan] **(d) 워커 수 제한** — 현재 1~10. add로 11번째 시도 시 거부 vs 한도 늘리기.

- [pending][plan] **(e) worker-bootstrap.js의 leader-fixed 의존 제거 정책** — OMC 차용 시 따라온 잔재로 워커 AGENTS.md에 "ACK·progress·blocker는 leader-fixed로 보내라"가 7곳에 박혀있다. 이전 세션에서 사용자가 정한 peer-to-peer 모델("리더 세션 불필요, 사용자가 페인 직접 관찰")과 정면 충돌. 다음 세션에서 결정할 정책:
  - (i) 7곳 모두 제거 → 워커는 사용자에게 자기 페인에서 직접 prompt
  - (ii) leader-fixed 채널 자체는 유지하되 "긴급 보고용"으로 제한, 평소 권한·결정은 페인 prompt
  - (iii) config 워커별 토글 추가 (예: `peer_to_peer: true`로 leader 의존 끄기)

### leader-fixed 자취 — worker-bootstrap.js 7곳 위치 (다음 세션 작업용)

- `worker-bootstrap.js:66` "If a command fails, report the exact stderr to leader-fixed before retrying."
- `worker-bootstrap.js:72` "Execute task work in small, verifiable increments and report each milestone to leader-fixed."
- `worker-bootstrap.js:87` "Keep reasoning focused on assigned task IDs and send concise progress acks to leader-fixed."
- `worker-bootstrap.js:88` "Before any risky command, send a blocker/proposal message to leader-fixed and wait for updated inbox instructions."
- `worker-bootstrap.js:110` startup ACK 명령 자동 주입 (`team api send-message --to leader-fixed --body "ACK: ${workerName} initialized"`)
- `worker-bootstrap.js:125, 181, 193` 워커 정체성 강제 ("You are NOT the leader", "Send ACK to the leader")
- `worker-bootstrap.js:176` leader 보내는 명령 템플릿 자동 노출

### 사실 (이번 세션에서 확정)

- [resolved][plan] 워커 CRUD 인터페이스는 `update` 단일 명령이 아닌 `remove` + `add` 두 명령 (사용자 결정). 더 명시적·유연.
- [resolved][plan] 추정 구현 비용 ~270줄 (remove 80 + add 120 + start 리팩토링 30 + cli 10 + docs 30)
- [resolved][plan] 기존 manifest.json은 부팅 시점 고정 모델 → CRUD 명령이 manifest.json을 직접 수정해야 함

### 사용자 시나리오의 본질 (배경)

사용자가 my-team start로 4개 워커 부팅했는데 한 워커(예: `source-server`)에 잘못된 cwd 또는 잘못된 launch_args를 박았다. 팀 전체 shutdown+start로 재부팅하면 살아있던 다른 3개 워커의 LLM 컨텍스트가 모두 사라진다. CRUD 명령은 잘못된 워커 하나만 교체해 나머지 워커의 컨텍스트를 보존한다.

### 트랩 / 주의

- [trap][plan] **tmux는 페인 생성 후 cwd 변경 불가.** "cwd만 살짝 수정"은 불가능 — 반드시 페인 kill + 새 페인 생성. 사용자가 페인 안에서 `cd /new/path` 해도 manifest.cwd는 옛 값 유지, AGENTS.md도 옛 cwd 기준.

- [trap][plan] **새 페인 = 새 LLM 프로세스 = 컨텍스트 0.** remove + add는 새 워커의 in-memory 대화 히스토리를 보존하지 않는다. 보존되는 건 mailbox/tasks/events.jsonl 같은 디스크 자산.

- [trap][plan] **tiled 레이아웃은 워커 수가 바뀌면 자동 재배치되지만, 페인 위치가 사용자 기억과 달라질 수 있다.** add/remove 후 사용자가 어느 페인이 어느 워커인지 헷갈리지 않도록 pane-border-status에 워커 이름 박혀있는 게 중요 (이미 적용됨, c4c7126).
