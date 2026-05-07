<!--
Origin: oh-my-claudecode v4.13.1, skills/deep-interview/SKILL.md
Copied: 2026-04-21
Modifications:
  - 4차원 점수 → 3차원(Goal/Constraints/Criteria)으로 단순화. 가중치 합 1.0
  - 점수 임계값을 우리 0~1 스케일에 맞춤 (knowledge/decisions/triage-scoring.md)
  - OMC 전용 트리거(`$deep-interview` magic keyword) 제거
  - 출력 형식을 triage.json 스키마(schemas/triage.schema.json)로 정렬
  - challenge agents 라운드 폐기 (Lead가 Phase 0에서 Metis 1회 호출만)
License: MIT (원본 동일)
-->

---
name: orch-deep-interview
description: Phase 0 Triage에서 Metis가 따르는 모호성 측정 절차. 사용자 요청을 3차원(Goal/Constraints/Criteria)으로 점수화하여 Question Debt 후보를 분류
trigger: lead-only (Phase 0 Metis 호출 시)
---

## 1. 목적

Phase 0 Triage에서 Metis 에이전트가 사용자 요청을 분석할 때 따르는 절차. 출력은 `agents/metis-result.json` (Lead가 `triage.json`으로 정규화).

## 2. 호출 주체

**Lead만 호출**한다. 에이전트끼리 호출하지 않는다 (P8). Metis는 이 스킬을 자기 프롬프트의 절차로 내장한다.

## 3. 절차

### Step 1 — 사용자 요청 분해

사용자 요청을 3개 차원으로 분리:

| 차원 | 질문 | 점수 0이 의미하는 것 | 점수 1이 의미하는 것 |
|---|---|---|---|
| Goal | 목표가 측정 가능한가 | 검증 가능한 단일 결과로 정의됨 | 추상적·다의적 |
| Constraints | 제약조건이 명시되었는가 | 모든 제약(시간/품질/외부 의존)이 명시 | 제약 거의 미정 |
| Criteria | 합격 기준이 검증 가능한가 | 객관적으로 검증 가능 | 부재 또는 주관적 |

각 차원에 0~1 점수를 부여한다.

### Step 2 — 가중합 계산

```
weighted_sum = 0.4·Goal + 0.3·Constraints + 0.3·Criteria
```

### Step 3 — 분류

| weighted_sum | 분류 | 비고 |
|---|---|---|
| < 0.35 | soft | confidence ≥ 0.7 |
| 0.35 ~ 0.65 | soft (낮은 신뢰도) | confidence < 0.7 |
| > 0.65 | hard | 사용자 결정 필요 |

**연쇄 영향 예외**: 점수와 무관하게 다른 태스크에 영향을 주는 모호함은 hard로 자동 승격.

### Step 4 — Question Debt 작성

각 모호성 항목을 `question_debts` 배열에 다음 필드로 작성:

- `id`: `qd-001` 형식
- `type`: business / technical / design / scope
- `blocking`: soft / hard
- `confidence_source`: `metis`
- `classifier_rationale`: 점수 산출 근거 한 줄
- `confidence` (soft인 경우): 0.7 이상이면 채택
- `provisional_assumption` (soft인 경우): 합리적 기본값
- `soft_criteria.has_reasonable_default`, `soft_criteria.impact_contained_to_task`: boolean

### Step 5 — 결과 작성

`agents/metis-result.json`에 `schemas/agent-result.schema.json` 형식으로 기록:

```json
{
  "task_id": "task-triage",
  "agent": "metis",
  "status": "DONE",
  "summary": "요청 분류 완료. soft 3건, hard 1건.",
  "question_debts": [...],
  "request_for_lead": []
}
```

추가로 점수 자체는 `triage.json`(Lead가 정규화) 형식의 객체로 result에 포함:

```json
{
  ...
  "deliverables": {
    "scores": {
      "goal": 0.3,
      "constraints": 0.5,
      "criteria": 0.2,
      "weighted_sum": 0.34
    },
    "rationale": "..."
  }
}
```

## 4. 금지 사항

- 사용자에게 직접 질문 금지 (P1)
- 다른 에이전트/스킬 spawn 금지 (P8)
- triage.json에 직접 쓰기 금지 — Metis는 자기 result 파일에만 쓴다 (P3)

## 5. 참고

- `knowledge/decisions/triage-scoring.md`
- `knowledge/decisions/question-debt-classification.md`
- `schemas/triage.schema.json`
- `schemas/agent-result.schema.json`
- 설계: `docs/design/orchestrator-v2.md` §2.2, §3.3
