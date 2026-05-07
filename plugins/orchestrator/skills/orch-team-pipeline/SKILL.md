<!--
Origin: oh-my-claudecode v4.13.1, skills/team/SKILL.md
Copied: 2026-04-21
Modifications:
  - tmux 워커 / `omc team` CLI 부분 전부 제거 (단일 Claude Code 세션 가정)
  - team-plan/team-prd/team-exec/team-verify/team-fix 5단계 파이프라인을 우리 6단계 Phase에 매핑
  - 모드(autopilot/ralph 등) 호출 부분 제거
  - "Lead만 spawn" 원칙 적용 (P8)
License: MIT (원본 동일)
-->

---
name: orch-team-pipeline
description: Phase 3 Implementation에서 Lead가 다중 에이전트를 병렬 spawn할 때 따르는 가이드. OMC team 파이프라인의 5단계를 우리 Phase 구조에 매핑
trigger: lead-only (Phase 3 진입 시 절차로 참조)
---

## 1. 목적

Phase 3 Implementation에서 Lead가 여러 에이전트를 병렬·순차 spawn할 때 따르는 절차.

## 2. 호출 주체

**Lead만 사용**. tmux 워커는 사용하지 않음. Claude Code의 `Agent` 도구 + `run_in_background`로 spawn.

## 3. OMC `team` 파이프라인 5단계 → 우리 Phase 매핑

| OMC team 단계 | 우리 Phase | 비고 |
|---|---|---|
| team-plan | Phase 2 (Synthesis) — Lead가 plan.json 작성 | planner 에이전트가 보조 |
| team-prd | Phase 1 (Research) — planner가 요구사항 구체화 | 별도 PRD 파일 안 만듦 (plan.json에 통합) |
| team-exec | Phase 3 (Implementation) | 본 스킬의 핵심 |
| team-verify | Phase 4 (Verification) | verifier + critic |
| team-fix | Phase 4 내부 루프 — fix 위임은 verifier의 request_for_lead로 처리 | 자동 루프 없음 |

## 4. Phase 3 Implementation 절차

### Step 1 — 의존성 그래프 분석

`tasks.json`에서 상태가 `READY`인 태스크를 모두 추출. 각각의 `depends_on`이 비어 있거나 모든 선행 태스크가 `DONE`인지 확인.

### Step 2 — 병렬화 분류

- **독립 태스크들** (서로 depends_on 없음) → 병렬 spawn (`run_in_background: true`)
- **의존성 체인** → 순차 spawn

### Step 3 — Spawn

각 태스크의 `category`/`assignee`에 따라 적절한 에이전트 호출:

```
Agent({
  description: "task-002 backend implementation",
  subagent_type: "backenddev",
  prompt: "...task-002 상세...",
  run_in_background: true (독립 태스크인 경우)
})
```

태스크 상태를 `READY` → `RUNNING`으로 갱신 (`tasks.json`).

### Step 4 — 결과 수신 + 수합

에이전트 완료 통지를 받으면:
1. `agents/{name}-result.json` 읽기 (스키마 검증)
2. result의 `question_debts` → `question-debt.json`에 append-merge
3. result의 `request_for_lead` → 즉시 처리하거나 다음 spawn 큐에 추가
4. 태스크 상태 `RUNNING` → `REVIEW` 또는 `DONE`
5. `status.json` 갱신
6. 의존 태스크의 선행이 모두 DONE이면 `READY`로 전환 + spawn

### Step 5 — 실패 처리

에이전트 실패 시 `knowledge/decisions/failure-recovery.md` §1 표 따라 처리. 2회 재시도 후 HARD_BLOCKED.

### Step 6 — Phase 3 종료

모든 태스크가 `DONE` 또는 `HARD_BLOCKED`이면 Phase 4로 전환.

## 5. 동시성 모델

- Lead는 단일 컨텍스트 → 통지를 직렬 처리 (race 없음)
- 에이전트는 자기 result 파일에만 쓰기 (P3) → 파일 충돌 없음

## 6. 금지 사항

- OMC `omc team` CLI / tmux 워커 사용 금지 (단일 세션 가정)
- 에이전트가 다른 에이전트 spawn 금지 (P8) — `request_for_lead`로 위임 요청만

## 7. 참고

- `schemas/tasks.schema.json`
- `knowledge/decisions/failure-recovery.md`
- `knowledge/decisions/agent-spawning-rules.md`
- 설계: `docs/design/orchestrator-v2.md` §6.3
