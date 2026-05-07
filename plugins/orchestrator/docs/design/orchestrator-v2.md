# Orchestrator v2 — 대표-Lead-실무조직 아키텍처 설계

**작성일**: 2026-04-20
**개정일**: 2026-04-21 (Codex/critic 리뷰 1차 반영)
**작성자**: Lead (Claude Opus 4.7)
**상태**: Draft v2 — 대표 승인 대기

---

## 0. 본 문서의 역할

현재 레포의 `CLAUDE.md`에 이미 정의된 오케스트레이션 규약(런 구조, Question Debt, 상태 머신, 에이전트 진화 파이프라인)은 **유지**한다. 본 설계 문서는 그 위에 다음을 **확장**한다.

1. 에이전트 페르소나 재설계 (OMO 차용)
2. Question Debt 분류·게이팅 에이전트 도입 (Metis/Momus 스타일)
3. 의사결정 대시보드 프로토콜 (`decisions.md`)
4. 외부 플러그인 스킬의 선택적 차용 (OMC `ralplan` / `deep-interview` / `ralph`)
5. 런타임 상태 모델 정식화
6. 작업 카테고리 → 에이전트·모델 라우팅 테이블

기존 `CLAUDE.md`를 수정할 항목은 **§9 변경 영향 범위**에 명시.

### 0.1 1차 리뷰 반영 요약

| 리뷰 지적 | 본 개정 반영 |
|---|---|
| 🔴 §3.3 점수 단위 모순 (max 1.0인데 임계값 1.5/2.5) | §3.3을 0~1 스케일로 재정의 |
| 🔴 §3.4 P4와 충돌 | decisions.md 제출과 상태 전환을 분리, EXECUTING 유지 원칙 보존 |
| 🔴 §8 기존 스키마 수정 누락 | §8에 기존 스키마 patch 항목 추가 |
| 🔴 §2.5 deep 카테고리 체인 표현 미정의 | "체인은 depends_on으로 분해된 다중 태스크"로 명시 |
| 🔴 실패 복구 누락 | §11 위험 테이블 확장 + §6.5 신설 (실패 복구 정책) |
| 🔴 권한 경계 강제 메커니즘 부재 | §2.2/§2.3에 disallowedTools 명시 |
| 🔴 테스트 전략 부재 | §10 Phase C에 합격 기준 + 회귀 정책 추가 |
| 🟡 비용 제어 | §2.5에 triage skip 조건 추가 |
| 🟡 관찰 가능성 | §4.4 신설 (실시간 진행 상태 표시) |
| 🟡 동시성 read-merge | §6.3에 read-merge 모델 명시 |
| 🟡 Momus 가치 의문 | §2.3에 critic과의 역할 분리 명시 + 통합 옵션을 §12 Q3로 |
| 🟡 모호함 5건 | 본문 각 섹션 명료화 |
| 🟡 추가 열린 질문 8건 | §12에 통합 (총 12개 질문) |

---

## 1. 철학적 원칙 (고정)

| 원칙 | 내용 | 출처 |
|---|---|---|
| P1. 모호해도 멈추지 않는다 | soft ambiguity는 가정 채택 후 진행, hard는 해당 태스크만 블록 | 기존 CLAUDE.md |
| P2. 대표는 최종 의사결정만 한다 | Lead가 실무를 오케스트레이션, 대표는 번호로 답변 | **본 문서 신규** |
| P3. Lead만 공유 파일을 쓴다 | 에이전트는 자기 result 파일에만 쓴다 | 기존 CLAUDE.md |
| P4. 완료까지 멈추지 않는다 | 실행 가능한 태스크가 남아 있으면 EXECUTING 유지 | 기존 CLAUDE.md + OMO Sisyphus |
| P5. 검증 없이 완료 선언 금지 | verifier의 증거 기반 판정 필수 | 기존 CLAUDE.md |
| P6. 의사결정은 체크포인트에서 모아서 제시 | 매번 묻지 않고, Phase 경계에서 번호 목록으로 | **본 문서 신규** |
| P7. 의사결정 제출은 실행 중단을 의미하지 않는다 | decisions.md 제출 후에도 실행 가능한 태스크는 계속 실행 | **본 문서 신규 (P4 보강)** |

---

## 2. 역할 계층 (대표 → Lead → 에이전트)

```
  [대표 (User)]                     — 최종 의사결정만
        │
        ▼  번호 답변 프로토콜
  [Lead (Main Session)]             — 오케스트레이터, 수합자
        │
        ▼  Task/Agent 배정
  ┌─────┴────────────────────────┐
  │  분류/검수 레이어              │
  │  ├── Metis  (요청 분류)        │
  │  └── Momus  (계획 검수)        │
  │                               │
  │  실무 레이어                   │
  │  ├── planner                  │
  │  ├── backenddev / appdev      │
  │  ├── designer                 │
  │  ├── critic / verifier        │
  │                               │
  │  참조 레이어 (옵션)            │
  │  ├── OMC `ralplan` (스킬)      │
  │  ├── OMC `deep-interview`     │
  │  └── OMC `ralph`              │
  └───────────────────────────────┘
```

### 2.1 Lead의 6단계 워크플로우 (CLAUDE.md 4단계 → 6단계로 확장)

기존 CLAUDE.md의 4단계 테이블을 다음 6단계로 **대체**한다 (§9에서 CLAUDE.md 수정 명시).

| Phase | 이름 | 목적 | 주체 |
|---|---|---|---|
| 0 | Triage | 요청 모호성 사전 분류 | Metis (**항상 수행**) |
| 1 | Research | 기존 코드/문서 탐색, 요구사항 구체화 | planner |
| 2 | Synthesis | 조사 결과 종합 → 계획 확정 | Lead 직접 |
| 2.5 | Plan Review | plan.json 실행 가능성 검수 | Momus (skip 가능, §2.5.2) |
| 3 | Implementation | 코드/문서 산출물 작성 | appdev / backenddev / designer |
| 4 | Verification | 빌드/테스트/검증 + 리뷰 | verifier / critic |
| 5 | Reporting | Question Debt 누적분 → decisions.md 제출 | Lead 직접 |

**Phase 경계** = 각 Phase 종료 시점. 총 7개 경계 (Phase 0/1/2/2.5/3/4/5 종료).

### 2.2 신규 에이전트: Metis (사전 분류자)

- **모델**: opus
- **역할**: 사용자 요청과 초기 컨텍스트를 입력받아 soft/hard 모호성 목록을 생성
- **입력**: 사용자 요청 원문 + (옵션) repository overview (Lead가 미리 수집)
- **출력**: `.orchestrator/runs/{run-id}/triage.json` — Lead가 작성을 위임받는 형태가 아니라, Metis가 자기 result 파일(`agents/metis-result.json`)에 작성한 뒤 Lead가 `triage.json`으로 복사·정규화 (P3 준수)
- **호출 타이밍**: 런 디렉터리 생성 직후, plan.json 작성 전
- **권한 (강제 메커니즘)**:
  - `tools: Read, Glob, Grep` (읽기 전용)
  - `disallowedTools: Write, Edit, Bash, TeamCreate, TeamDelete`
- **점수 체계**: §3.3 참조
- **출처**: OMO Metis + OMC `deep-interview` 4차원 점수 융합

### 2.3 신규 에이전트: Momus (계획 검수자)

- **모델**: opus
- **역할**: plan.json 초안의 실행 가능성을 검수
- **검수 항목 (체크리스트)**:
  - 참조된 파일/심볼이 실제로 존재하는가
  - depends_on 그래프에 순환이 없는가
  - 각 태스크의 assignee가 카테고리 라우팅 테이블(§2.5.1)에 부합하는가
  - hard_blocked 가능성 높은 태스크를 조기 식별 (이유 명시)
- **입력**: `.orchestrator/runs/{run-id}/plan.json` (초안)
- **출력**: `agents/momus-result.json` — 승인/조건부 승인/반려 + 사유 + 태스크별 권고
- **호출 타이밍**: Phase 2.5 (Synthesis 종료 후, Implementation 진입 전)
- **반려 처리**: §2.3.1 참조
- **권한**:
  - `tools: Read, Glob, Grep`
  - `disallowedTools: Write, Edit, Bash, TeamCreate, TeamDelete`
- **critic과의 역할 분리**:
  - Momus = **계획 단계**의 실행 가능성 검수 (file/symbol 존재, dependency cycle, assignee fit)
  - critic = **계획 단계의 품질** 검토 (누락, 반례, 리스크) + 최종 산출물 리뷰
  - 둘 다 plan.json을 읽지만 관점이 다름. 통합 가능성은 §12 Q3에서 사용자에게 묻는다.

#### 2.3.1 Momus 반려 시 루프

1. Momus가 반려 → Lead가 result.json을 읽고 **planner를 재호출**하여 plan.json 수정 지시 (Lead 직접 수정 금지, "Lead 직접 구현 금지" 안티패턴 회피)
2. 수정된 plan.json을 다시 Momus로 보냄
3. **최대 2회까지 재시도** (총 3회 검수). 3회 모두 반려 시:
   - Lead가 Momus 반려 사유 전체를 `decisions.md`로 제출 (Q: "Momus가 X를 이유로 반려. override할까요?")
   - 런은 이 태스크를 HARD_BLOCKED로 두고 나머지 태스크 진행 (P4·P7 준수)

### 2.4 기존 에이전트 (유지 + 매핑)

| 에이전트 | 역할 | 모델 | 변경사항 |
|---|---|---|---|
| planner | 요구사항 정리, 계획 초안 | opus | 그대로 (단, triage.json을 입력으로 받도록 확장) |
| backenddev | 서버/API/DB 코드 | sonnet | 그대로 |
| appdev | 클라이언트 앱 코드 | sonnet | 그대로 |
| designer | UI/UX 설계 | sonnet | 그대로 |
| critic | 누락/반례/리스크 검토 | opus | 그대로 (Momus와 역할 구분, §2.3) |
| verifier | 빌드/테스트/동작 검증 | sonnet | 그대로 |

### 2.5 작업 카테고리 → 에이전트·모델 라우팅

#### 2.5.1 라우팅 테이블

| 카테고리 | 용도 | 담당 에이전트 | 기본 모델 | 체인 표현 |
|---|---|---|---|---|
| `triage` | 요청 분류 | Metis | opus | 단일 |
| `plan-review` | 계획 검수 | Momus | opus | 단일 |
| `plan` | 계획 수립 | planner | opus | 단일 |
| `quick` | 단일 파일 수정·조회·리팩터 | backenddev / appdev | sonnet | 단일 |
| `deep` | 복잡 로직·아키텍처 결정 | (분해 필수) | opus(판단) + sonnet(실행) | **체인 → depends_on으로 다중 태스크 분해** |
| `visual` | UI/UX | designer | sonnet | 단일 |
| `verify` | 빌드/테스트/검증 | verifier | sonnet | 단일 |
| `review` | 코드/계획 리뷰 | critic | opus | 단일 |

`deep` 카테고리의 체인 표현 (예시):
```json
{
  "tasks": [
    {"id": "T1", "category": "plan", "assignee": "planner", "depends_on": []},
    {"id": "T2", "category": "quick", "assignee": "backenddev", "depends_on": ["T1"]},
    {"id": "T3", "category": "review", "assignee": "critic", "depends_on": ["T2"]}
  ]
}
```
즉, 체인은 plan.json/tasks.json의 `depends_on`으로 표현하고, `assignee`는 항상 단일 문자열을 유지한다. 스키마 변경 부담 최소화.

#### 2.5.2 Phase Skip 조건 (비용 제어)

**Phase 0 Triage는 항상 수행** (대표 정책 결정, 2026-04-21). 사용자 요청은 어떤 형태든 Metis가 모호성을 4차원 점수로 측정한다. 이유: Triage skip이 거짓 음성(false negative)을 만들 위험이 비용 절감보다 크다고 판단. 단순 요청에서도 Metis는 빠르게 "skip_recommended_for_review: true" 결과를 낼 수 있고, 그 자체가 명시적 진단 기록이 된다.

**Plan Review skip 조건 (Phase 2.5)**:
- plan.json의 태스크 수가 1개일 때
- 모든 태스크의 카테고리가 `quick` 또는 `verify`만 있을 때
- 또는 사용자가 명시적 플래그 `[no-plan-review]` 포함

skip 결정은 `tasks.json`의 메타에 기록 (관찰 가능성 §4.4).

---

## 3. Question Debt 워크플로우 (확장)

기존 CLAUDE.md의 JSON 형식은 유지. 다음을 확장:

### 3.1 분류 주체

- **기존**: 각 에이전트가 자체 판정
- **변경**: **Metis가 1차 분류**(triage 단계), 각 에이전트는 실행 중 발견된 신규 debt만 자체 기록
- **편차 대응**: critic이 Phase 2.5에서 plan.json과 함께 triage.json을 검토. critic이 "Metis 분류가 의심스럽다"고 판단하면 해당 debt를 critic-result.json의 `disputed_debts` 배열에 적시 → Lead가 사용자에게 우선 제출

### 3.2 신규 필드

```json
{
  "id": "qd-001",
  "confidence_source": "metis" | "planner" | "backenddev" | "...",
  "classifier_rationale": "Goal=0.3, Constraints=0.5, Criteria=0.2 → 가중합 0.34. soft 임계 0.50 미만이므로 soft.",
  "disputed_by": ["critic"]   // 선택적, 분류 이의 제기 시
}
```

### 3.3 점수 체계 (재정의 — 0~1 스케일)

각 차원은 **0~1 범위**의 모호성 점수. 가중치 합산 결과도 0~1 범위.

| 차원 | 의미 | 가중치 |
|---|---|---|
| Goal | 목표가 측정 가능한가 | 0.40 |
| Constraints | 제약조건이 명시되었는가 | 0.30 |
| Criteria | 합격 기준이 검증 가능한가 | 0.30 |

가중합 = `0.4·Goal + 0.3·Constraints + 0.3·Criteria` ∈ [0, 1]

| 가중합 | 분류 | 비고 |
|---|---|---|
| < 0.35 | soft | 높은 신뢰도, 기본값 안전 |
| 0.35 ~ 0.65 | soft (낮은 신뢰도) | 가정 채택하되 confidence < 0.7로 기록 |
| > 0.65 | hard | 사용자 확인 필요 |

**연쇄 영향 조건**: 점수와 무관하게 "다른 태스크에 연쇄 영향"이 있으면 hard로 승격 (CLAUDE.md 기존 규칙 유지).

### 3.4 decisions.md 제출 트리거 (P7과 양립)

P4·P7을 보존하기 위해 "decisions.md 제출"과 "상태 전환"을 **분리**한다.

| 트리거 조건 | 동작 |
|---|---|
| Phase 경계에서 신규 hard debt가 ≥1개 누적됨 | decisions.md에 추가 항목 작성, Run 상태 변경 없음 (EXECUTING 유지) |
| 모든 실행 가능한 태스크가 완료됐고 미해결 hard debt가 남음 | Run 상태 → WAITING_USER로 전환 |
| 모든 태스크가 완료됐고 미해결 debt 없음 | Run 상태 → DONE |

즉, **WAITING_USER는 P4 그대로** "정말 더 이상 진행 가능한 태스크가 없을 때만". `50% hard_blocked`라는 기존 §3.4 임계 규칙은 폐기.

decisions.md는 Phase 경계마다 **누적 갱신**되며, 대표는 언제든 답변 가능. 답변 도착 시 Lead가 즉시 적용.

---

## 4. 의사결정 대시보드 프로토콜

### 4.1 파일 구조

`.orchestrator/runs/{run-id}/decisions.md`

```markdown
# Decisions Required — run-{id}

**최종 갱신**: 2026-04-21T14:30:00Z
**현재 Phase**: Implementation (진행 중)
**현재 Run 상태**: EXECUTING (실행 가능 태스크 잔여)
**대표 답변 형식**: `Q1: 2, Q2: a, Q3: 보류`

---

## Q1. 환불 기한 설정
**상태**: open
**맥락**: 결제 API 구현 중
**영향 범위**: payment 모듈, 고객 지원 프로세스
**현재 가정**: 7일 (confidence 0.75, source: metis)

1. **7일** — 가정 유지. 장점: 이미 구현됨. 단점: 업계 평균(14일)보다 짧음.
2. **14일** — 재구현 필요. 장점: 업계 표준. 단점: 부정 사용 위험.
3. **30일** — 재구현 필요. 장점: 고객 친화적. 단점: 매출 인식 지연.

**권고**: 2번. 이유: 업계 표준에 맞추는 것이 장기적으로 안전.

---
```

### 4.2 대표 답변 프로토콜

대표는 **다음 채널 중 하나**로 답변:

1. **파일 작성**: `.orchestrator/runs/{run-id}/decisions-reply.md`에 한 줄
2. **터미널 입력**: 다음 메시지에 답변 텍스트 포함

#### 4.2.1 파서 명세

- 답변 형식: `Q<번호>: <선택>` 쉼표 구분 또는 줄바꿈 구분
- `<선택>` 허용 토큰: 숫자(1, 2, 3, ...), 알파벳(a, b, c, ...), `보류`, `defer`, `skip`
- 대소문자 무시, 공백 무시
- 매칭 정규식: `Q\s*(\d+)\s*:\s*([0-9a-zA-Z]+|보류|defer|skip)`
- "보류"/"defer"/"skip"으로 답한 항목은 debt status를 `deferred`로 두고 런 종료 시 summary에 포함
- **파싱 실패 시**: Lead가 사용자에게 재질문 ("Q1, Q2 답변을 명시 형식으로 다시 알려주세요. 예: `Q1: 2`")

### 4.3 갱신 모델

decisions.md는 **누적 파일**이다. Phase 경계마다 신규 hard debt가 발견되면 Lead가 항목을 추가만 한다(기존 항목 수정 금지). 대표 답변이 도착하면 해당 항목의 `**상태**`를 `resolved` 또는 `deferred`로 갱신.

### 4.4 관찰 가능성 — 실시간 진행 상태 표시 (신규)

대표가 런 진행 상태를 빠르게 파악하도록:

#### 4.4.1 `status.json` 신규 파일

`.orchestrator/runs/{run-id}/status.json` — Lead가 매 Phase 진입/종료 시 갱신:

```json
{
  "run_id": "run-20260421-143022",
  "current_phase": "implementation",
  "phase_started_at": "2026-04-21T14:35:00Z",
  "run_state": "EXECUTING",
  "tasks_summary": {
    "total": 7,
    "done": 3,
    "running": 2,
    "ready": 1,
    "hard_blocked": 1
  },
  "open_decisions": 2,
  "skipped_phases": ["triage"]
}
```

#### 4.4.2 터미널 알림

다음 시점에 Lead가 한 줄 알림 출력:
- decisions.md에 신규 항목 추가 시: `[DECISIONS] Q3 추가됨. 현재 미해결 3건. 답변 시: decisions-reply.md 또는 한 줄 입력.`
- Phase 전환 시: `[PHASE] Synthesis → Plan Review (Momus 호출 중)`
- Run 종료 시: `[DONE] run-{id} 완료. summary.md 확인. 미해결 debt: 0건.`

#### 4.4.3 사용자가 직접 조회 가능한 파일

- `status.json` — 현재 상태 한눈에
- `tasks.json` — 태스크별 상태
- `decisions.md` — 미해결 의사결정
- `summary.md` — 종료 후 최종 보고

---

## 5. 외부 스킬 차용 전략 (대표 정책: 복사 + 자산 편입)

### 5.1 원칙 (개정 — 2026-04-21)

- 외부 플러그인(OMC/OMX/OMO)의 **스킬/프롬프트를 우리 `.claude/skills/`로 복사**하여 orchestrator 자산으로 편입
- 복사된 스킬은 우리 Question Debt·decisions.md·Phase 6단계 프로토콜에 맞게 **수정 후 사용**
- 외부 플러그인 폴더(`oh-my-claudecode/`, `oh-my-codex/`, `oh-my-openagent/`)는 **참조용으로만 보존**, 런타임은 우리 복사본만 사용
- 외부 플러그인이 업데이트되어도 우리 복사본은 의도적으로 격리 (변경 추적은 우리가 명시적으로 진행)
- 이유: 외부 버전 변경 비종속 + 우리 프로토콜과의 일관성 + 런타임 동작의 명시적 통제

### 5.2 복사 절차

각 스킬 복사 시:

1. 외부 경로 → `.claude/skills/orch-{원본명}/SKILL.md`로 복사. **prefix `orch-` 필수** (외부 동명 스킬과 충돌 방지)
2. SKILL.md 상단에 출처 명시:
   ```markdown
   <!--
   Origin: oh-my-claudecode v4.13.1, skills/ralplan/SKILL.md
   Copied: 2026-04-21
   Modifications:
     - 우리 Phase 6단계 매핑 추가
     - plan.json 스키마 참조로 변경
   License: MIT (원본 동일)
   -->
   ```
3. 원본의 OMC 전용 트리거(`$ralplan`, `magic keywords`)는 제거하거나 우리 식으로 변경
4. Question Debt·decisions.md 출력 형식 추가
5. 다른 외부 스킬을 호출하는 부분이 있으면 우리 복사본을 가리키도록 경로 수정 또는 인라인화

### 5.3 1차 복사 대상 카탈로그

| 외부 스킬 | 우리 경로 | 차용 목적 | 우리 식 핵심 수정 |
|---|---|---|---|
| OMC `skills/deep-interview/SKILL.md` | `.claude/skills/orch-deep-interview/SKILL.md` | Phase 0 Triage(Metis)가 내부적으로 따르는 4차원 점수 절차 | 점수 스케일을 우리 0~1 정의(§3.3)에 정렬 |
| OMC `skills/ralplan/SKILL.md` | `.claude/skills/orch-ralplan/SKILL.md` | Phase 2 Synthesis 시 plan.json 작성의 정신 모델 (Principles/Drivers/Options) | RALPLAN-DR 구조를 plan.json 스키마와 매핑 |
| OMC `skills/ralph/SKILL.md` | `.claude/skills/orch-ralph/SKILL.md` | Phase 4 Verification의 story-by-story 검증 원칙 | verifier 에이전트 프롬프트에 통합 |
| OMC `skills/team/SKILL.md` | `.claude/skills/orch-team-pipeline/SKILL.md` | Phase 3 Implementation 병렬 실행 가이드 | 우리 6단계 Phase 매핑 표 추가, OMC 전용 모드는 제거 |
| OMC `skills/deep-dive/SKILL.md` | `.claude/skills/orch-deep-dive/SKILL.md` (선택적, Phase 1에서 trace 필요 시) | Phase 1 Research에서 trace → interview 2단 파이프 | 선택적 — Phase 1 사용 사례가 명확해진 뒤 복사 |
| OMC `skills/verify/SKILL.md` | `.claude/skills/orch-verify/SKILL.md` | Phase 4 verifier의 증거 기반 완료 판정 절차 | "should work" 거짓말 방어 룰 강화 |

### 5.4 차용하지 않는 것

- **OMC `autopilot`**: 거부. 이유 — (1) Lead의 의사결정 책임을 분산시킴 (오케스트레이터 역할 침식), (2) 자체 QA·재시도 로직이 우리 Question Debt·decisions.md 프로토콜과 충돌 가능, (3) 내부에서 team/ralph/ultrawork를 재귀 호출하여 §6.4 재귀 spawn 금지 원칙 위반. 부분 차용(autopilot의 QA 사이클 아이디어)은 v3에서 검토 (§12 Q12).
- **OMO `Sisyphus` 페르소나 네이밍**: Lead 자체가 그 역할이므로 별도 명명 불필요.
- **OMO Hashline 편집**: 현재 Claude Code 기본 Edit 도구 사용. v3로 미룸 (§12 Q4 + `docs/design/v3-todo.md`).
- **OMC `team-bridge.cjs` / `omc team` CLI**: 외부 tmux 의존 인프라는 도입하지 않음 (orchestrator는 단일 Claude Code 세션 가정).

---

## 6. 런타임 상태 모델 (확장)

### 6.1 기존 상태 머신 (유지)

```
Run:   NEW → PLANNING → EXECUTING ⇄ PARTIAL_BLOCKED → REVIEWING → PUBLISHING → DONE
                                                                     ↘ WAITING_USER
Task:  NEW → READY → RUNNING → REVIEW → DONE / HARD_BLOCKED
```

### 6.2 런 디렉터리 구조 (확장)

| 파일 | 작성자 | 용도 | 신규 |
|---|---|---|---|
| `triage.json` | Lead (Metis result에서 정규화) | 요청 분류 결과 | ✅ |
| `plan.json` | Lead | 태스크 계획 | 기존 |
| `tasks.json` | Lead | 태스크 상태 수합 | 기존 |
| `question-debt.json` | Lead | debt 수합 | 기존 |
| `assumptions.md` | Lead | 가정 목록 | 기존 |
| `decisions.md` | Lead | 대표 제출용 | ✅ |
| `decisions-reply.md` | 대표 (선택적) | 대표 답변 | ✅ |
| `status.json` | Lead | 실시간 진행 상태 | ✅ |
| `summary.md` | Lead | 최종 보고 | 기존 |
| `run.md` | Lead | 런 요약 | 기존 |
| `agents/*-result.json` | 각 에이전트 | 결과 파일 | 기존 |

### 6.3 동시성 — Lead의 read-merge 모델

병렬 spawn된 에이전트들의 완료 통지를 Lead가 받아 처리할 때의 가정:

- Lead = Claude Code 메인 세션. Claude Code의 `run_in_background` 백그라운드 통지는 Lead의 다음 turn에 도달.
- Lead는 통지를 **수신 순서대로 직렬 처리**한다 (Lead 자체가 단일 컨텍스트이므로 동시 처리 불가).
- 각 통지마다 다음 시퀀스로 처리:
  1. `agents/{agent-name}-result.json` 읽기
  2. result의 `question_debts`를 `question-debt.json`에 append-merge
  3. 해당 태스크의 `tasks.json` 상태를 `RUNNING` → `REVIEW` 또는 `DONE`으로 변경
  4. 의존 태스크가 READY로 전환 가능하면 spawn

**충돌 방지**:
- 각 에이전트 = 자기 result 파일에만 쓰기 (P3)
- Lead = `tasks.json`/`question-debt.json`/`status.json`의 단일 writer
- 따라서 race condition 없음

### 6.4 재귀 spawn 방지

에이전트 템플릿(`.claude/agents/templates/*.tmpl.md`)에 다음을 명시:

- frontmatter: `disallowedTools: TeamCreate, TeamDelete, Agent, Task` (재귀 차단의 핵심)
- 본문: "에이전트는 다른 에이전트나 스킬을 spawn하지 않는다. 필요 시 result.json의 `request_for_lead` 배열에 위임 요청을 기록"
- OMC 스킬 중 `team`/`autopilot`/`ralph`/`ultrawork`/`self-improve`/`ccg` 류의 호출도 명시적으로 금지
- critic이 Phase 4에서 각 에이전트의 도구 사용 로그를 사후 감사 (재귀 시도 적발)

### 6.5 실패 복구 정책 (신규)

#### 6.5.1 에이전트 spawn 실패

| 실패 유형 | 대응 |
|---|---|
| Metis API 오류/타임아웃 (Phase 0) | **2회 재시도 후 skip**. triage.json 비어 있는 채로 진행. 모든 debt는 각 에이전트가 자체 분류. |
| Momus API 오류/타임아웃 (Phase 2.5) | **2회 재시도 후 skip**. critic이 plan.json을 추가 검토하도록 fallback. |
| 일반 에이전트 (planner/backenddev 등) 오류 | **2회 재시도 후 해당 태스크 HARD_BLOCKED**. 사유를 `failure_reason` 필드로 기록. |

#### 6.5.2 결과 파일 손상

Lead가 `agents/*-result.json`을 읽을 때 JSON 파싱 실패 또는 schema validation 실패 시:
1. 해당 파일을 `agents/{name}-result.corrupt.json`으로 보존
2. 에이전트를 1회 재호출하여 재생성 요청
3. 재생성도 실패하면 해당 태스크 HARD_BLOCKED + decisions.md에 추가

#### 6.5.3 Lead 세션 중단 (context compaction / 사용자 종료)

- Lead 세션 종료 시점의 `tasks.json` / `status.json`이 그대로 남음
- 새 Claude Code 세션에서 사용자가 "run-{id} resume"을 요청하면 Lead는:
  1. `status.json`을 읽어 마지막 Phase 확인
  2. `tasks.json`에서 `RUNNING` 상태의 태스크를 `READY`로 되돌림 (재실행 가능)
  3. `READY` 상태부터 spawn 재개
- resume 시점에 모든 `RUNNING` 태스크를 무조건 재실행하므로 **에이전트는 idempotent**해야 함 (해당 사항을 templates에 명시)

#### 6.5.4 WAITING_USER 상태의 TTL

- WAITING_USER 상태인 런은 **30일 후 자동 만료** (생성 시각 기준)
- 만료된 런은 `summary.md`에 "MISSED_DEADLINE" 표시 후 DONE으로 전환
- 새 런 시작 시 WAITING_USER 상태인 런이 있으면 Lead가 알림: `[WARN] WAITING_USER 런 N개 존재. ls .orchestrator/runs/ 로 확인. 새 런을 시작하시겠습니까?`
- 사용자가 "예" 또는 무응답이면 새 런 시작. 기존 런은 그대로 유지(자동 취소 안 함).

### 6.6 비용 통제 가이드

| 모델 | 호출 빈도 (런당 기본) | 비고 |
|---|---|---|
| opus | 최소 2회 (Metis + planner) ~ 최대 5회 (Metis + planner + Momus + critic + critic 추가 검수) | Phase 0 Triage는 항상 수행(Q6 결정). Plan Review만 skip 가능 |
| sonnet | 태스크 수만큼 (대부분 backenddev/appdev/designer/verifier) | 카테고리별 라우팅 |
| haiku | 사용 안 함 (현재 v2 범위 외) | v3에서 explore-style 에이전트 도입 시 검토 |

대표가 비용을 빠르게 가늠할 수 있도록, `summary.md` 끝부분에 "에이전트 호출 횟수 (모델별)" 섹션 추가.

---

## 7. `.claude/agents/*.md` 파일 생성 계획

에이전트 진화 파이프라인(기존 CLAUDE.md §에이전트 진화 파이프라인)을 그대로 사용. 변경점:

### 7.1 신규 템플릿 2개

- `.claude/agents/templates/metis.tmpl.md`
- `.claude/agents/templates/momus.tmpl.md`

### 7.2 기존 6개 템플릿 패치

모든 templates에 다음 frontmatter 항목 추가:
- `disallowedTools: TeamCreate, TeamDelete, Agent, Task`
- 본문에 "재귀 spawn 금지 — 위임 필요 시 result.json의 `request_for_lead` 사용" 1문단

### 7.3 `knowledge/agent-mapping.json` 업데이트

```json
{
  "metis": {
    "template": "metis.tmpl.md",
    "decisions": [
      "knowledge/decisions/triage-scoring.md",
      "knowledge/decisions/question-debt-classification.md"
    ]
  },
  "momus": {
    "template": "momus.tmpl.md",
    "decisions": [
      "knowledge/decisions/plan-review-criteria.md"
    ]
  }
}
```

### 7.4 신규 knowledge 문서

- `knowledge/decisions/triage-scoring.md` — Metis의 0~1 스케일 4차원 점수 기준 (§3.3)
- `knowledge/decisions/question-debt-classification.md` — soft/hard 게이트 + decisions.md 분리 정책 (§3.4)
- `knowledge/decisions/plan-review-criteria.md` — Momus 검수 체크리스트 + critic과의 분리 (§2.3)
- `knowledge/decisions/decision-dashboard-protocol.md` — decisions.md 형식 + 파서 명세 (§4)
- `knowledge/decisions/agent-spawning-rules.md` — 재귀 spawn 금지 + 위임 요청 형식 (§6.4)
- `knowledge/decisions/failure-recovery.md` — 실패 복구 정책 (§6.5)

### 7.5 `knowledge/principles.md` 확장

기존 principles 유지 + 신규 3개 추가:
- P2 "대표는 최종 의사결정만 한다"
- P6 "의사결정은 Phase 경계에서 모아서 제시"
- P7 "의사결정 제출은 실행 중단을 의미하지 않는다"
- "에이전트는 다른 에이전트를 spawn하지 않는다"

### 7.6 런 단위 에이전트 버전 고정

런 시작 시점의 `knowledge/principles.md` + `agent-mapping.json`의 git commit hash를 `status.json`의 `agents_version` 필드에 기록. 런 도중 knowledge가 갱신돼도 현재 런은 시작 시점 버전을 사용 (재현성 확보).

### 7.7 복사된 외부 스킬 카탈로그 (Phase A에서 일괄 복사)

§5.3의 1차 복사 대상 스킬을 Phase A에서 `.claude/skills/` 밑으로 복사한다. 복사 실행 시 §5.2 절차 준수.

| 우리 스킬명 | 사용 시점 | 호출 주체 | 비고 |
|---|---|---|---|
| `orch-deep-interview` | Phase 0 Triage | Metis (내부 절차로 참조) | 점수 0~1 정렬 필수 |
| `orch-ralplan` | Phase 2 Synthesis | Lead (plan.json 작성 시 정신 모델) | 직접 invoke 아님, 프롬프트 참조 |
| `orch-team-pipeline` | Phase 3 Implementation | Lead (병렬 실행 가이드) | OMC 전용 모드 제거 |
| `orch-verify` | Phase 4 Verification | verifier (프롬프트 통합) | "should work" 방어 |
| `orch-ralph` | Phase 4 Verification | verifier (story-by-story 검증) | verifier 프롬프트에 흡수 |
| `orch-deep-dive` | Phase 1 Research (선택적) | planner (필요 시) | Phase 1 사용 패턴 명확화 후 복사 |

---

## 8. JSON Schema 작업 계획

### 8.1 신규 스키마 (4개)

- `schemas/triage.schema.json`
- `schemas/agent-result.schema.json` (현재 없음 — 모든 에이전트 result.json 검증)
- `schemas/status.schema.json`
- `schemas/decisions.frontmatter.schema.json` (markdown frontmatter만 검증)

### 8.2 기존 스키마 patch (4개)

- `schemas/plan.schema.json`:
  - `assignee` enum에 `metis`, `momus` 추가
  - 각 task에 `category` 필드 추가 (enum: `triage`/`plan-review`/`plan`/`quick`/`deep`/`visual`/`verify`/`review`)
- `schemas/tasks.schema.json`:
  - 각 task에 `category` 필드 추가
  - `failure_reason` 옵션 필드 추가 (string)
  - status enum에 변경 없음 (기존 그대로)
- `schemas/question-debt.schema.json`:
  - 각 debt에 `confidence_source` (string), `classifier_rationale` (string), `disputed_by` (array of string) 필드 추가
- `schemas/run-metadata.schema.json` (있다면):
  - `agents_version` 필드 추가

### 8.3 triage.json 스키마 정의

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "TriageResult",
  "type": "object",
  "required": ["run_id", "scores", "classified_debts", "skip_recommended"],
  "properties": {
    "run_id": {"type": "string"},
    "scores": {
      "type": "object",
      "required": ["goal", "constraints", "criteria", "weighted_sum"],
      "properties": {
        "goal": {"type": "number", "minimum": 0, "maximum": 1},
        "constraints": {"type": "number", "minimum": 0, "maximum": 1},
        "criteria": {"type": "number", "minimum": 0, "maximum": 1},
        "weighted_sum": {"type": "number", "minimum": 0, "maximum": 1}
      }
    },
    "classified_debts": {
      "type": "array",
      "items": {"$ref": "question-debt.schema.json#/definitions/debt"}
    },
    "skip_recommended": {"type": "boolean"},
    "skip_reason": {"type": "string"}
  }
}
```

---

## 9. 변경 영향 범위 (CLAUDE.md 수정 필요 항목)

| CLAUDE.md 섹션 | 변경 유형 | 내용 |
|---|---|---|
| 핵심 원칙 | 추가 | P2, P6, P7 원칙 추가 |
| Question Debt 규칙 | 확장 | Metis 0~1 점수 보조 판정, confidence_source/classifier_rationale 필드, decisions.md 제출과 상태 전환 분리 |
| 에이전트 실행 흐름 | **대체** | 기존 4단계 표 → 6단계(0/1/2/2.5/3/4/5)로 전면 교체 |
| 에이전트 정의 테이블 | 추가 | metis, momus 2행 추가 |
| 상태 머신 | 주석 추가 | WAITING_USER 전환 기준 명료화 (P4·P7 보존, 실행 가능 태스크 0일 때만) + TTL 30일 |
| 런 디렉터리 구조 | 추가 | triage.json, decisions.md, decisions-reply.md, status.json 추가 |
| (신규 섹션) 실패 복구 정책 | 신규 | §6.5 내용 요약 |
| (신규 섹션) 비용 통제 | 신규 | §6.6 요약 |

위 수정은 **본 문서 대표 승인 + Phase A 실행 시점**에 일괄 적용.

---

## 10. 구현 로드맵

### Phase A — 문서 & 스키마 & 스킬 복사 (대표 승인 후 즉시)

1. `knowledge/principles.md` 확장 (P2/P6/P7 + 재귀 금지)
2. `knowledge/decisions/` 6개 신규 문서 작성
3. `schemas/` 신규 4개 + 기존 4개 patch
4. `CLAUDE.md` §9 변경사항 일괄 반영
5. **외부 스킬 6개를 §5.3 카탈로그에 따라 `.claude/skills/orch-*/`로 복사 + 우리 식 수정 적용**
6. `docs/design/v3-todo.md` 작성 (Hashline 도입, autopilot QA 차용 등 후속 작업 추적)

### Phase B — 에이전트 템플릿 & 재생성

5. `.claude/agents/templates/metis.tmpl.md`, `momus.tmpl.md` 작성
6. 기존 6개 템플릿에 재귀 금지 + disallowedTools patch
7. `knowledge/agent-mapping.json` 업데이트
8. 에이전트 진화 파이프라인 실행 → `.claude/agents/*.md` 8개 재생성
9. 생성된 에이전트 frontmatter / 도구 화이트리스트 검증 (verifier가 정합성 점검)

### Phase C — 파일럿 런 (검증)

10. **합격 기준** (모두 통과해야 Phase C 종료):
    - C1. triage.json 생성 + triage.schema.json 검증 통과
    - C2. plan.json에 metis/momus가 assignee로 등장 가능 (스키마 통과)
    - C3. Momus 정상 동작 — 의도적으로 dependency cycle을 가진 plan으로 테스트하면 반려 결과 생성
    - C4. Metis skip 조건 트리거 — 명확한 요청 ("rename foo to bar in src/x.ts") 입력 시 triage 자동 skip되고 status.json에 기록
    - C5. decisions.md 생성 + 파서가 답변 (`Q1: 2`)을 정확히 적용
    - C6. 강제 실패 시나리오 — Metis를 의도적으로 disable한 상태에서 Phase 0 fallback 동작 확인
    - C7. status.json이 매 Phase 전환 시 갱신됨 (timestamp 검증)
11. 합격 기준 미충족 시 갭만 메우는 micro-revision (전체 재설계 X)
12. 발견된 잔여 갭은 Question Debt로 적립 → v3 후보

### Phase D — 회귀 정책 (Phase C 통과 후 영구 운영)

- 에이전트 템플릿이나 knowledge/decisions 변경 시: **변경 PR마다 파일럿 런 1회 재실행** 필수
- 새 에이전트 추가 시: 합격 기준 C1~C7에 해당 에이전트용 항목 추가
- 회귀 실패는 새 PR 머지 차단

---

## 11. 위험과 완화

| 위험 | 완화 |
|---|---|
| Metis 분류 편향 (hard를 soft로 오판) | critic이 Phase 2.5에서 triage.json 별도 검증 (`disputed_by` 필드) |
| Momus가 지나치게 엄격하게 반려 → 무한 루프 | 최대 2회 재시도 후 사용자에게 위임 (§2.3.1) |
| Metis/Momus API 실패로 런 멈춤 | 2회 재시도 후 skip + fallback (§6.5.1) |
| 결과 파일 손상 | 1회 재생성 시도 + 실패 시 HARD_BLOCKED (§6.5.2) |
| Lead 세션 중단 | status.json 기반 resume + 에이전트 idempotent 강제 (§6.5.3) |
| decisions.md 장기 방치 | 30일 TTL → 자동 만료 (§6.5.4) |
| WAITING_USER 런 누적 | 새 런 시작 시 알림, 자동 취소 안 함 (§6.5.4) |
| 외부 플러그인 직접 호출 유혹 | §5.1 원칙 명시 + critic 사후 감사 |
| 재귀 spawn 실수 | disallowedTools 강제 + critic 사후 감사 (§6.4) |
| 비용 폭증 (opus 호출 다수) | skip 조건(§2.5.2) + summary.md 호출 횟수 표기(§6.6) |
| run-id 같은 초에 충돌 | 1인 사용 가정상 발생 가능성 매우 낮음. 발생 시 Lead가 `-2` suffix 부여 (Question Debt로 적립) |
| Metis의 단일 장애점 (SPOF) | Phase 0 skip 조건 + critic의 disputed 필드 + 각 에이전트의 자체 debt 분류 보조 (§3.1) |
| 기존 런 미완료 상태에서 새 런 시작 | 알림만 표시, 강제하지 않음 (§6.5.4) |

---

## 12. 대표 결정 사항 (2026-04-21 확정)

| # | 질문 | 결정 |
|---|---|---|
| Q1 | Metis/Momus 그리스 이름 유지 | **유지** |
| Q2 | Metis 1차 분류 + 에이전트 2차 보강 | **유지** |
| Q3 | Momus와 critic 분리 유지 | **분리 유지** |
| Q4 | Hashline은 v3로 | **동의** + `docs/design/v3-todo.md`에 명시 추적 |
| Q5 | Phase 6단계화, 기존 4단계 대체 | **승인** (각 단계 의미는 §2.1 표 + 본 문서 부록 C 참조) |
| Q6 | **Triage skip 조건 제거 — 항상 Triage 수행** | **변경** (§2.5.2 갱신) |
| Q7 | WAITING_USER = 실행 가능 태스크 0일 때만 (P4 보존) | **동의** |
| Q8 | 답변 파싱 실패 시 재질문 정책 | **동의** |
| Q9 | 기존 WAITING_USER 런 자동 취소 안 함 | **동의** |
| Q10 | 런당 opus 최대 5회 수용 | **수용** |
| Q11 | 런 단위 knowledge 버전 고정 | **고정** |
| Q12 | autopilot 차용 거부 유지 | **유지** (이유 §5.4 본문에 명시) |
| Q13 | **외부 플러그인 스킬을 우리 자산으로 복사** | **변경** (§5 전면 개정, §7.7 카탈로그) |

### 12.1 Q6/Q12/Q13 결정의 영향 요약

- **Q6 변경**: Triage skip 룰 폐기 → §2.5.2에서 "Phase 0 항상 수행" 명시. opus 호출 횟수가 줄어들지 않음 (런당 최소 1회는 Metis 호출). 대신 **모든 요청에 대해 모호성 점수 기록이 강제**되어 추적성·일관성 향상.
- **Q12 결정**: autopilot 거부 이유 3가지를 §5.4 본문에 명시 — (1) Lead 책임 분산, (2) Question Debt 프로토콜 충돌, (3) 재귀 spawn 위험.
- **Q13 변경**: 외부 스킬을 `.claude/skills/orch-*/`로 복사 → §5 전면 개정. Phase A에 복사 단계 추가(§10). `orch-` prefix로 외부 동명 스킬과 충돌 방지. 복사본은 출처·라이선스·수정사항 명시 필수.

---

## 부록 A — 참조 자료

- `CLAUDE.md` (레포 루트)
- `oh-my-claudecode/` — 특히 `skills/ralplan/SKILL.md`, `skills/deep-interview/SKILL.md`, `skills/team/SKILL.md`, `agents/critic.md`, `agents/planner.md`
- `oh-my-codex/` — 특히 `prompts/planner.md`, `prompts/verifier.md`, `crates/omx-runtime-core/`
- `oh-my-openagent/` — 특히 `src/agents/metis.ts`, `src/agents/momus.ts`, `src/agents/prometheus/`, `src/agents/sisyphus.ts`

## 부록 C — Phase 6단계 의미·목적 (Q5 결정 사유)

| Phase | 무엇을 하는가 | 왜 필요한가 |
|---|---|---|
| **0 Triage** | 사용자 요청을 받자마자 모호성을 4차원 점수(Goal/Constraints/Criteria)로 측정하고 분류 | 시작 전에 어디가 위험한지 사전 진단. 나중에 "이거 정의 안 됐네"를 발견하지 않도록 |
| **1 Research** | 기존 코드/문서를 탐색하고 요구사항을 구체화 | 맥락 없이 계획을 세우면 잘못된 가정을 한다. 같은 문제가 이미 풀려 있을 수도 있음 |
| **2 Synthesis** | Research + Triage 결과를 종합하여 plan.json 확정 | 조사와 실행 사이의 변환 단계. Lead가 흩어진 정보를 구조화된 계획으로 정리 |
| **2.5 Plan Review** | plan.json의 실행 가능성 검수 (파일 존재, 의존성 순환, 담당자 적합성) | 잘못된 계획으로 Implementation 진입 시 비용 폭증. 코드 짜기 전에 결함 잡음 |
| **3 Implementation** | 검증된 plan을 따라 실제 산출물 작성 | 실제 변경이 일어나는 단계. 코드는 여기서만 만들어진다 |
| **4 Verification** | 빌드/테스트/실제 동작 확인 + 코드 리뷰 | Implementation의 자기 보고는 신뢰하지 않는다 (P5). 별도 검증 없으면 "should work" 거짓말이 통과됨 |
| **5 Reporting** | Question Debt + Phase 결과를 정리하여 summary.md / decisions.md 최종화 | 대표가 결과를 빠르게 파악하고 의사결정 가능하도록. 무엇이 가정 기반인지 명시 안 하면 의사결정 불가 |

**왜 Phase 0과 2.5를 추가했는가**: 기존 4단계는 "행동" 중심이라 사전 게이팅이 빠져 있었음. Phase 0 = 시작 전 진단, Phase 2.5 = 실행 전 검수. 둘 다 비용·시간 낭비를 막는 안전장치.

## 부록 B — 용어

- **Lead**: orchestrator 메인 세션 (Claude Code 메인 컨텍스트)
- **대표**: 본 시스템의 사용자, 최종 의사결정자
- **Run**: 한 사용자 요청에 대한 전체 실행 단위 (`.orchestrator/runs/{run-id}/`)
- **Phase**: 한 Run 내부의 단계 (Triage / Research / Synthesis / Plan Review / Implementation / Verification / Reporting — Phase 0/1/2/2.5/3/4/5)
- **Phase 경계**: 각 Phase 종료 시점 (총 7개 경계)
- **Task**: Run 내 개별 작업 단위
- **Question Debt (qd)**: 모호성 적립 항목
- **Persona**: 에이전트의 역할 정체성 (Metis, Momus 등 그리스 이름 또는 기능 이름)
- **disallowedTools**: 에이전트 frontmatter에서 호출 금지 도구를 명시하는 필드 (Claude Code 내장 권한 메커니즘)
- **idempotent**: 같은 입력으로 여러 번 실행해도 결과·부작용이 1회 실행과 동일한 성질 (resume 시 안전성)
