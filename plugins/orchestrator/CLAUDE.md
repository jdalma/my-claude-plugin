# Orchestrator — 로컬 멀티 에이전트 오케스트레이션

이 프로젝트는 Claude Code Agent Teams 기반의 개인용 멀티 에이전트 오케스트레이션 작업실이다.

> **현재 버전**: v2 (2026-04-21 적용). 설계 문서: `docs/design/orchestrator-v2.md`. 후속 작업: `docs/design/v3-todo.md`.

---

## 핵심 원칙

1. **P1. 모호해도 멈추지 않는다.** 모호한 지점을 만나면 즉시 사용자에게 묻지 말고 Question Debt로 적립하고 계속 진행한다.
2. **P2. 대표는 최종 의사결정만 한다.** Lead가 실무 오케스트레이션을 담당하고, 대표는 Phase 경계에서 번호 답변 프로토콜로 응답한다.
3. **P3. Lead만 공유 파일을 쓴다.** 에이전트는 자기 result 파일에만 쓴다.
4. **P4. 완료까지 멈추지 않는다.** 실행 가능한 태스크가 한 개라도 남아 있으면 EXECUTING 유지.
5. **P5. 검증 없이 완료 선언 금지.** verifier의 증거 기반 판정 필수.
6. **P6. 의사결정은 Phase 경계에서 모아서 제시한다.** 대표를 매번 호출하지 않는다.
7. **P7. 의사결정 제출은 실행 중단을 의미하지 않는다.** decisions.md 제출 후에도 실행 가능한 태스크는 계속 실행 (P4와 양립).
8. **P8. 에이전트는 다른 에이전트를 spawn하지 않는다.** Lead만 spawn 권한.

부가:
- **에이전트 간 통신은 구조화된 JSON 파일로 한다.** 자연어가 아닌 스키마가 있는 형식.
- **에이전트 수는 태스크 규모에 따라 조절한다.** 소규모면 Lead + 1~2개, 대규모면 확장.

원칙 상세는 `knowledge/principles.md`.

---

## Question Debt 규칙

### soft/hard 분류 기준

**두 조건을 모두 만족해야 soft. 하나라도 불충분하면 hard.** (기존 규칙 유지)

| 조건 | soft | hard |
|------|------|------|
| 합리적 기본값이 존재하는가? | 있다 | 없다 |
| 틀려도 해당 태스크만 수정하면 되는가? | 그렇다 | 다른 태스크에 연쇄 영향 |

### 보조: Metis 점수 기반 판정 (v2 신규)

Phase 0에서 Metis가 4차원(0~1 스케일) 가중합 점수로 사전 분류:
- 가중합 = `0.4·Goal + 0.3·Constraints + 0.3·Criteria`
- < 0.35 → soft (높은 신뢰도), 0.35~0.65 → soft (낮은 신뢰도), > 0.65 → hard
- 연쇄 영향 조건은 점수와 무관하게 hard로 자동 승격
- 상세: `knowledge/decisions/triage-scoring.md`

### 신규 필드 (v2)

각 debt에 다음 필드를 기록:
- `confidence_source`: 분류한 에이전트 이름 (metis/planner/...)
- `classifier_rationale`: 분류 근거 한 줄
- `disputed_by`: 분류에 이의를 제기한 에이전트 목록 (예: critic이 Metis 분류 의심 시)

상세: `knowledge/decisions/question-debt-classification.md`.

### 처리 방식

- **soft**: provisional assumption을 채택하고 계속 진행. 결과 파일의 `question_debts` 배열에 기록.
- **hard**: 해당 태스크를 HARD_BLOCKED 처리. 나머지 태스크는 계속 진행.

### 멈추지 않는 규칙 (P4 + P7)

- question debt가 쌓여도 실행 가능한 태스크가 있으면 EXECUTING 유지.
- decisions.md에 항목이 추가돼도 Run 상태는 변경되지 않는다 (P7).
- WAITING_USER는 모든 실행 가능 태스크가 완료되고 미해결 hard debt가 남았을 때만 전환.
- WAITING_USER 상태는 30일 TTL. 만료 시 자동 DONE 처리 (`knowledge/decisions/failure-recovery.md` §4).

---

## 런(Run) 구조

모든 작업은 런 단위로 관리한다.

### 런 디렉터리 (v2 확장)

```
.orchestrator/runs/{run-id}/
├── run.md                  — Lead가 작성. 런 요약 (사람 가독용)
├── triage.json             — Lead가 작성 (Metis result에서 정규화). Phase 0 분류 결과 [v2 신규]
├── plan.json               — Lead가 작성. 분해된 태스크 계획
├── tasks.json              — Lead만 쓰기. 태스크 상태 수합
├── question-debt.json      — Lead만 쓰기. debt 수합
├── assumptions.md          — Lead가 작성. 가정 목록 (사람 가독용)
├── status.json             — Lead가 매 Phase 전환 시 갱신. 실시간 상태 [v2 신규]
├── decisions.md            — Lead가 누적 갱신. 대표 제출용 [v2 신규]
├── decisions-reply.md      — 대표 답변 (선택적, 터미널 입력 대신) [v2 신규]
├── summary.md              — Lead가 작성. 최종 보고
└── agents/                 — 각 에이전트가 자기 파일만 쓰기
    └── {agent-name}-result.json
```

### run-id 규칙

`run-YYYYMMDD-HHmmss` 형식. 예: `run-20260421-143022`. 같은 초 충돌 시 `-2`/`-3` suffix.

---

## 에이전트 실행 흐름

### Lead (메인 세션)의 역할

Lead는 오케스트레이터다. 직접 구현하지 않고 에이전트를 배정하고 결과를 종합한다.

### 6단계 워크플로우 (v2 — 기존 4단계 대체)

| Phase | 이름 | 목적 | 주체 | Skip |
|---|---|---|---|---|
| 0 | Triage | 요청 모호성 사전 분류 | Metis | **항상 수행** |
| 1 | Research | 기존 코드/문서 탐색, 요구사항 구체화 | planner | - |
| 2 | Synthesis | 조사 결과 종합 → plan.json 확정 | Lead 직접 | - |
| 2.5 | Plan Review | plan.json 실행 가능성 검수 | Momus | 조건부 (단일 태스크 또는 quick/verify만일 때) |
| 3 | Implementation | 코드/문서 산출물 작성 | appdev/backenddev/designer | - |
| 4 | Verification | 빌드/테스트/검증 + 리뷰 | verifier + critic | - |
| 5 | Reporting | Question Debt 누적분 → decisions.md/summary.md 최종화 | Lead 직접 | - |

각 Phase의 의미·목적은 `docs/design/orchestrator-v2.md` 부록 C 참조.

### 실행 절차

1. 사용자 요청을 받으면 런 디렉터리를 생성한다 (run-id 부여, status.json 초기화).
2. **Phase 0 — Triage**: Metis를 호출하여 triage.json을 생성한다.
3. **Phase 1 — Research**: planner를 호출하여 코드/문서 탐색 + 요구사항 구체화.
4. **Phase 2 — Synthesis**: Lead가 plan.json을 작성하고 tasks.json을 초기화한다 (전체 태스크 NEW).
5. **Phase 2.5 — Plan Review**: Momus를 호출하여 plan.json 검수. 반려 시 planner 재호출 (최대 2회).
6. **Phase 3 — Implementation**: 에이전트를 spawn한다.
   - 독립 태스크는 병렬로 (`run_in_background: true`)
   - 의존성 있는 태스크는 순차로
   - 에이전트 완료 후 결과 파일을 읽어 수합 (tasks.json, question-debt.json 갱신)
7. **Phase 4 — Verification**: verifier(동작) + critic(품질) 호출.
8. **Phase 5 — Reporting**: decisions.md 최종화, summary.md 작성.

### Lead 안티패턴 (절대 하지 않을 것)

- **"에이전트가 말하길..."식 전달 금지**: 에이전트 결과를 그대로 넘기지 않는다. Lead가 직접 읽고 종합한다.
- **직접 구현 금지**: Lead는 코드를 직접 작성하지 않는다. 구현은 반드시 전문 에이전트에 위임한다.
- **검증 없이 완료 선언 금지**: Implementation 후 반드시 Verification 단계를 거친다 (P5).
- **에이전트 spawn 권한 위임 금지**: 에이전트가 다른 에이전트를 spawn하게 두지 않는다 (P8). 위임 요청은 result.json의 `request_for_lead`로 받는다.

### 에이전트의 규칙

- `.orchestrator/runs/{run-id}/agents/{자기이름}-result.json`에만 쓴다.
- `tasks.json`, `question-debt.json`, `triage.json`, `decisions.md`, `status.json`은 **읽기만** 가능. 쓰기는 Lead.
- 다른 에이전트의 result 파일은 읽기 가능 (참조용).
- 모호한 지점을 만나면 result 파일의 `question_debts` 배열에 기록한다.
- 다른 에이전트나 OMC 스킬을 spawn하지 않는다 — `request_for_lead`로 위임 요청.

---

## 에이전트 결과 파일 형식

스키마: `schemas/agent-result.schema.json`

```json
{
  "task_id": "task-001",
  "agent": "backenddev",
  "status": "DONE",
  "summary": "결제 API 엔드포인트 4개 작성 완료",
  "artifacts": ["src/payment/api.kt", "src/payment/model.kt"],
  "question_debts": [
    {
      "id": "qd-001",
      "type": "business",
      "blocking": "soft",
      "status": "assumed",
      "title": "환불 기한 미정",
      "question_for_user": "환불 기한을 며칠로 설정할까요?",
      "provisional_assumption": "7일",
      "why_it_matters": "환불 로직에 직접 영향",
      "impact_scope": ["payment"],
      "confidence": 0.75,
      "confidence_source": "backenddev",
      "classifier_rationale": "기본값 존재(업계 평균 14일), 영향 범위 payment 모듈 내부",
      "soft_criteria": {
        "has_reasonable_default": true,
        "impact_contained_to_task": true
      }
    }
  ],
  "request_for_lead": []
}
```

`request_for_lead` 형식은 `knowledge/decisions/agent-spawning-rules.md` 참조.

---

## Question Debt JSON 형식

스키마: `schemas/question-debt.schema.json`. v2 신규 필드는 위 §에이전트 결과 파일 형식 예시 참조.

---

## Plan / Tasks JSON 형식

스키마: `schemas/plan.schema.json`, `schemas/task.schema.json`.

`category` 필드는 v2 §2.5.1 라우팅 테이블 참조:
`triage`/`plan-review`/`plan`/`quick`/`deep`/`visual`/`verify`/`review`

`assignee` enum에 `metis`, `momus` 추가 (v2 §2.2/§2.3).

```json
{
  "run_id": "run-20260421-143022",
  "goal": "TODO 앱 백엔드 API 설계 및 구현",
  "tasks": [
    {
      "id": "task-001",
      "category": "plan",
      "assignee": "planner",
      "title": "요구사항 정리",
      "depends_on": []
    },
    {
      "id": "task-002",
      "category": "quick",
      "assignee": "backenddev",
      "title": "API 엔드포인트 구현",
      "depends_on": ["task-001"]
    }
  ]
}
```

Task 상태: `NEW` → `READY` → `RUNNING` → `REVIEW` → `DONE` / `HARD_BLOCKED`

---

## Decisions Dashboard (v2 신규)

대표(사용자)와의 의사결정 채널. 상세: `knowledge/decisions/decision-dashboard-protocol.md`.

### 흐름

1. Phase 경계에서 신규 hard debt가 누적되면 Lead가 `decisions.md`에 항목 추가 (누적 갱신, 기존 항목 수정 금지).
2. Lead가 터미널에 한 줄 알림: `[DECISIONS] Q{N} 추가됨. 답변 시: decisions-reply.md 또는 한 줄 입력.`
3. 대표는 `decisions-reply.md`에 또는 다음 메시지로 답변: `Q1: 2, Q2: a, Q3: 보류`.
4. Lead가 답변을 파싱하여 해당 debt status를 `resolved` 또는 `deferred`로 갱신.

### 답변 형식

- 정규식: `Q\s*(\d+)\s*:\s*([0-9a-zA-Z]+|보류|defer|skip)`
- 대소문자/공백 무시
- 보류/defer/skip → debt status: `deferred`
- 파싱 실패 시 재질문

---

## Summary 형식

최종 보고는 반드시 세 섹션으로 분리한다.

```markdown
# Run Summary — {run-id}

## 완료된 일
- [확정적으로 처리된 태스크 목록]

## 가정 기반 처리
- [assumption 위에서 진행한 태스크. 각각의 가정과 confidence 명시]

## 미해결 질문
- [사용자 확인이 필요한 항목. hard blocked 포함, deferred debt 포함]

## 에이전트 호출 횟수 (모델별)
- opus: N회 (Metis, planner, ...)
- sonnet: M회
```

---

## 실시간 진행 상태 — status.json (v2 신규)

스키마: `schemas/status.schema.json`. Lead가 매 Phase 전환 시 갱신.

```json
{
  "run_id": "run-20260421-143022",
  "current_phase": "implementation",
  "phase_started_at": "2026-04-21T14:35:00Z",
  "run_state": "EXECUTING",
  "tasks_summary": {"total": 7, "done": 3, "running": 2, "ready": 1, "hard_blocked": 1},
  "open_decisions": 2,
  "skipped_phases": [],
  "agents_version": "<git commit hash>"
}
```

대표가 빠르게 조회 가능: `cat .orchestrator/runs/{run-id}/status.json | jq`.

---

## 실패 복구 정책 (v2 신규)

상세: `knowledge/decisions/failure-recovery.md`.

| 실패 | 처리 |
|---|---|
| Metis API 실패 | 2회 재시도 후 skip. 각 에이전트가 자체 분류 |
| Momus API 실패 | 2회 재시도 후 skip. critic이 Phase 4에서 plan 추가 검토 |
| 일반 에이전트 실패 | 2회 재시도 후 해당 태스크 HARD_BLOCKED + failure_reason 기록 |
| 결과 파일 손상 | 1회 재생성 시도. 실패 시 HARD_BLOCKED + corrupt 백업 |
| Lead 세션 중단 | status.json 기반 resume. RUNNING 태스크는 READY로 되돌려 재실행 (에이전트 idempotent 강제) |
| WAITING_USER 30일 경과 | 자동 만료 → DONE (MISSED_DEADLINE 표기) |

---

## 비용 통제 (v2 신규)

| 모델 | 호출 빈도 (런당) |
|---|---|
| opus | 최소 2회 (Metis + planner) ~ 최대 5회 |
| sonnet | 태스크 수만큼 |

Phase 0 Triage는 항상 수행 (대표 정책 결정, Q6). Plan Review만 skip 조건 있음.

summary.md 끝에 호출 횟수 기록.

---

## 에이전트 진화 파이프라인

사용자가 의사결정 내용을 전달하면, 아래 절차에 따라 지식을 정제하고 에이전트를 진화시킨다.

### 파이프라인 구조

```
knowledge/
  principles.md              — 핵심 원칙 (모든 에이전트 공유)
  decisions/                 — 구체적 의사결정 기록
    {topic}.md
  agent-mapping.json         — 어떤 지식이 어떤 에이전트에 해당하는지

.claude/agents/templates/    — 에이전트 구조 템플릿 (역할, 제약, 출력 형식)
  {agent}.tmpl.md

.claude/agents/              — 최종 에이전트 정의 (템플릿 + 지식 합성 결과)
  {agent}.md

.claude/skills/              — 외부 플러그인에서 복사한 우리 자산 스킬 (v2 신규)
  orch-{name}/SKILL.md       — orch- prefix 필수 (v2 §5.2)
```

### 실행 절차

**Step 1 — 지식 정제**: 원칙/규칙/근거 추출.

**Step 2 — 지식 저장**:
- 범용 원칙 → `knowledge/principles.md`에 추가
- 구체적 의사결정 → `knowledge/decisions/{topic}.md`로 생성

각 결정 파일 형식:
```markdown
# {제목}

## 결정
## 근거
## 적용 범위
## 관련 에이전트
## 참고
```

**Step 3 — 매핑 업데이트**: `knowledge/agent-mapping.json`의 해당 에이전트 `decisions` 배열에 추가.

**Step 4 — 에이전트 재생성**:
1. `templates/{agent}.tmpl.md`를 읽는다
2. `agent-mapping.json`에서 매핑된 지식 파일 목록 확인
3. `principles.md` + 매핑된 decisions 파일들 읽기
4. 템플릿의 `<Domain_Knowledge>` 섹션에 지식 주입
5. `.claude/agents/{agent}.md` 덮어쓰기

**Step 5 — 검증**: frontmatter 형식, 필수 섹션 존재, 도구 화이트리스트(`disallowedTools` 포함) 확인.

### 새 에이전트 추가

1. `templates/{agent}.tmpl.md` 작성
2. `agent-mapping.json`에 항목 추가
3. 파이프라인 실행

### 런 단위 에이전트 버전 고정 (v2 §7.6)

런 시작 시점의 `knowledge/principles.md` + `agent-mapping.json` git commit hash를 `status.json`의 `agents_version`에 기록. 런 도중 knowledge가 갱신돼도 현재 런은 시작 시점 버전을 사용 (재현성).

### 주의사항

- `templates/`는 구조만 정의. 지식은 넣지 않는다.
- `.claude/agents/*.md`는 빌드 결과물. 직접 수정 금지.
- `principles.md`는 모든 에이전트 공유.
- 모든 templates에 `disallowedTools: TeamCreate, TeamDelete, Agent, Task` 강제 (재귀 spawn 방지).

---

## 에이전트 정의

에이전트 정의는 `.claude/agents/`에 markdown 파일로 관리된다 (자동 생성).

### 사용 가능한 에이전트 (v2)

| 에이전트 | 역할 | 모델 | Phase |
|----------|------|------|------|
| metis | 사전 분류 (요청 모호성 점수화) | opus | 0 |
| planner | 기획 정리, 요구사항 구체화 | opus | 1 |
| momus | 계획 검수 (실행 가능성, 의존성, 라우팅 적합성) | opus | 2.5 |
| appdev | 앱 클라이언트 코드 작성 | sonnet | 3 |
| backenddev | 서버/API/DB 코드 작성 | sonnet | 3 |
| designer | UI/UX 설계, 화면 구조 | sonnet | 3 |
| critic | 누락, 반례, 리스크 검토 (읽기 전용) | opus | 4 |
| verifier | 빌드/테스트 실행, 실제 동작 검증 | sonnet | 4 |

### OMC 스킬 사용 규칙

- 외부 OMC 플러그인 스킬은 직접 호출하지 않는다. 우리 자산 스킬(`.claude/skills/orch-*/`)만 호출한다 (v2 §5).
- 오케스트레이션 스킬(team, autopilot, ralph, ultrawork, self-improve, ccg)은 재귀 spawn 위험으로 영구 금지 (P8).
- 각 에이전트가 사용 가능한 우리 자산 스킬은 frontmatter `skills` 배열에 명시.

---

## 상태 머신

### Run 상태

```
NEW → PLANNING → EXECUTING ⇄ PARTIAL_BLOCKED → REVIEWING → PUBLISHING → DONE
                                                                    ↘ WAITING_USER
```

- Question Debt가 쌓여도 실행 가능한 태스크가 있으면 EXECUTING 유지 (P4).
- decisions.md 제출은 Run 상태를 변경하지 않는다 (P7).
- WAITING_USER는 모든 실행 가능 태스크가 완료되고 미해결 hard debt가 남았을 때만.
- WAITING_USER는 30일 TTL.

### Task 상태

```
NEW → READY → RUNNING → REVIEW → DONE
                  ↘ HARD_BLOCKED
```

- HARD_BLOCKED 태스크에는 `failure_reason` 필드를 기록한다 (v2 §6.5).
