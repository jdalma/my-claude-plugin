# Question Debt Classification — soft/hard 게이트 + 상태 전환 정책

## 결정

### 1. 분류 주체

- **1차 분류**: Metis가 Phase 0에서 사용자 요청을 분석하여 triage.json에 debt 후보를 분류
- **2차 분류**: 각 에이전트가 실행 중 신규로 발견한 debt를 자체 result 파일에 기록 (Metis 점수 체계와 동일한 기준 사용)
- **이의 제기**: critic이 Phase 2.5 Plan Review에서 triage.json을 검토하다가 분류가 의심스러우면 `disputed_by` 필드에 자기 이름을 추가

### 2. 두 조건 모두 만족해야 soft (기존 CLAUDE.md 규칙 유지)

| 조건 | soft | hard |
|---|---|---|
| 합리적 기본값 존재 (`has_reasonable_default`) | true | false |
| 영향이 해당 태스크에 국한 (`impact_contained_to_task`) | true | false |

위 boolean 두 개로도 분류한 뒤, Metis는 추가로 점수 기반 보조 판정을 수행 (`triage-scoring.md` 참조).

### 3. decisions.md 제출과 Run 상태 전환의 분리 (P7)

`decisions.md` 제출은 단순 신호이며, 그 자체로 Run 상태를 변경하지 않는다.

| 트리거 조건 | decisions.md 동작 | Run 상태 |
|---|---|---|
| Phase 경계에서 신규 hard debt가 ≥1개 누적됨 | 항목 추가 (누적 갱신) | 변경 없음 (EXECUTING 유지) |
| 모든 실행 가능 태스크가 완료됐고 미해결 hard debt 잔존 | 최종화 | WAITING_USER로 전환 |
| 모든 태스크 완료 + 미해결 debt 없음 | 최종화 | DONE |

## 근거

- 기존 CLAUDE.md의 "두 조건 모두 만족해야 soft" 규칙은 사람이 직관적으로 적용하기 좋아 유지
- Metis 점수 체계는 "두 조건"을 기계적으로 평가하기 위한 보조 도구
- P7(의사결정 제출은 실행 중단 아님)을 도입한 이유: 기존 P4(완료까지 멈추지 않음)와 모순되지 않도록 명시적 분리 필요

## 적용 범위

- 모든 에이전트가 result.json에 question_debts를 기록할 때
- Lead가 question-debt.json을 수합·갱신할 때
- Lead가 decisions.md를 갱신할 때 (Phase 경계마다)

## 관련 에이전트

- metis (1차 분류)
- 모든 실무 에이전트 (2차 보강 분류)
- critic (분류 이의 제기)

## 참고

- `docs/design/orchestrator-v2.md` §3
- `triage-scoring.md` (점수 체계 상세)
- `decision-dashboard-protocol.md` (decisions.md 형식)
