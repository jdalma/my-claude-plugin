<!--
Origin: oh-my-claudecode v4.13.1, skills/ralplan/SKILL.md
Copied: 2026-04-21
Modifications:
  - OMC `magic keyword` 게이팅 제거 (autopilot/ralph 등 외부 모드 호출 부분)
  - RALPLAN-DR 구조를 우리 plan.json 스키마와 매핑하여 사용
  - 우리 6단계 Phase에서 Phase 2 Synthesis용 정신 모델로 사용
  - Lead 직접 호출 (planner는 이 절차를 참고하되, 호출 주체는 Lead)
License: MIT (원본 동일)
-->

---
name: orch-ralplan
description: Phase 2 Synthesis에서 plan.json을 작성할 때의 정신 모델. RALPLAN-DR 구조(Principles 3-5 / Decision Drivers top 3 / Options ≥2)를 plan.json 작성에 적용
trigger: lead-only (Phase 2 진입 시 Lead가 절차로 참조)
---

## 1. 목적

Phase 2 Synthesis에서 Lead가 plan.json을 작성할 때 RALPLAN-DR 구조를 따른다. 단순히 태스크 나열이 아니라 "왜 이 분해인가"를 명시.

## 2. 호출 주체

**Lead만 사용**. 에이전트가 호출하는 스킬이 아니라, Lead의 작업 절차.

## 3. 절차

### Step 1 — Principles 추출 (3~5개)

이 plan을 지배하는 원칙을 3~5개 적는다. 예:
- "결제는 idempotent해야 한다 (중복 호출 안전)"
- "외부 API 호출은 모두 retry + circuit breaker"
- "DB 쓰기는 트랜잭션 boundary 안에서만"

원칙은 plan.json의 `goal` 필드 또는 별도 `principles` 필드(선택)에 기록.

### Step 2 — Decision Drivers 식별 (top 3)

이 plan의 분해 방식을 결정한 핵심 driver 3개:
- 시간 제약 (예: "4시간 내 완료")
- 품질 임계 (예: "테스트 커버리지 80%")
- 외부 의존성 (예: "결제 게이트웨이 API 응답시간")

### Step 3 — Options 비교 (≥2개)

선택한 분해 방식 외에 검토한 대안을 최소 1개 명시 (총 2개 이상 비교):

| Option | 장점 | 단점 | 채택 |
|---|---|---|---|
| A. 마이크로서비스 분해 | 독립 배포 | 복잡도 증가 | ❌ |
| B. 단일 모듈 + 인터페이스 분리 | 단순 | 향후 분리 비용 | ✅ |

이 비교 결과를 `assumptions.md`에 기록.

### Step 4 — Task 분해

각 태스크에 `category` 부여 (v2 §2.5.1 라우팅):
- `triage` (Metis만)
- `plan-review` (Momus만)
- `plan` (planner)
- `quick` (단일 파일·짧은 작업)
- `deep` (복잡 — depends_on으로 분해된 체인)
- `visual` (designer)
- `verify` (verifier)
- `review` (critic)

`deep` 카테고리는 단일 태스크가 아니라 **depends_on으로 연결된 다중 태스크 체인**으로 표현.

### Step 5 — Momus 검수 진입

작성된 plan.json은 Phase 2.5에서 Momus로 보내 검수받는다. 반려 시 planner를 재호출 (Lead 직접 수정 금지 — 안티패턴).

## 4. plan.json 스키마

`schemas/plan.schema.json`. 필수 필드: `id`, `assignee`, `title`, `category`, `depends_on`.

## 5. 금지 사항

- OMC `autopilot`, `ralph`, `team` 등 외부 모드 호출 금지 (P8)
- plan 작성 중 외부 사용자 질문 금지 — 모호함은 Question Debt로 (P1)

## 6. 참고

- `schemas/plan.schema.json`
- `knowledge/decisions/plan-review-criteria.md` (Momus의 검수 기준)
- 설계: `docs/design/orchestrator-v2.md` §2.5, §5.2
