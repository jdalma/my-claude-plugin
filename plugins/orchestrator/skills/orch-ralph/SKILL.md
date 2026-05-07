<!--
Origin: oh-my-claudecode v4.13.1, skills/ralph/SKILL.md
Copied: 2026-04-21
Modifications:
  - "self-referential loop" 메커니즘 제거 (재귀 spawn 위험 — P8)
  - story-by-story 검증 원칙만 추출하여 verifier 에이전트의 절차로 흡수
  - Lead 호출 + 에이전트 spawn 형태로 변경 (스킬 자체가 루프 돌지 않음)
License: MIT (원본 동일)
-->

---
name: orch-ralph
description: Phase 4 Verification에서 verifier가 따르는 story-by-story 검증 원칙. plan의 각 태스크를 독립적인 story로 보고 하나씩 증거 기반으로 검증
trigger: lead-only (Phase 4 verifier 호출 시 절차로 참조)
---

## 1. 목적

Phase 4 Verification에서 verifier가 산출물을 검증할 때, 한 번에 전체를 보지 말고 **태스크 단위(story)로 분리하여 각각 증거 기반 합격/불합격 판정**한다.

## 2. 호출 주체

**Lead만 호출**. verifier는 이 스킬의 절차를 자기 프롬프트에 내장.

## 3. 절차

### Step 1 — Story 식별

`tasks.json`에서 status가 `REVIEW` 또는 `DONE`인 태스크를 모두 추출. 각 태스크 = 한 story.

### Step 2 — 각 Story별 증거 수집

태스크의 acceptance criteria가 무엇이었는지 plan.json/agents/{name}-result.json에서 확인. 각 criterion에 대해:

| 증거 종류 | 우선순위 |
|---|---|
| 실제 빌드 통과 출력 | 1 |
| 실제 테스트 통과 출력 | 1 |
| 실제 동작 확인 (스크린샷, curl 응답, log) | 1 |
| typecheck/lint 통과 | 2 |
| 코드 정적 분석 (LSP diagnostics) | 3 |
| 추론 / "should work" | **금지** (P5 위반) |

### Step 3 — Story별 판정

각 story에 다음 중 하나:
- `pass` — 증거 충족
- `fail` — 증거 부재 또는 실패
- `partial` — 일부 criterion 충족 (가정 기반인 경우 별도 표시)

### Step 4 — 결과 작성

`agents/verifier-result.json`에 `findings` 배열로 기록:

```json
{
  "task_id": "task-verify",
  "agent": "verifier",
  "status": "DONE",
  "summary": "5개 story 검증. 4 pass, 1 fail.",
  "findings": [
    {
      "story": "task-002",
      "verdict": "pass",
      "evidence": [
        {"kind": "test_output", "command": "npm test", "result": "5/5 passing"},
        {"kind": "build", "command": "npm run build", "result": "compiled OK"}
      ]
    },
    {
      "story": "task-003",
      "verdict": "fail",
      "evidence": [
        {"kind": "test_output", "command": "npm test -- task-003", "result": "1/3 failing: 'refund timeout'"}
      ],
      "fix_suggestion": "환불 timeout 처리 누락. backenddev 재호출 필요"
    }
  ],
  "request_for_lead": [
    {"kind": "delegate", "to_agent": "backenddev", "reason": "task-003 fail fix"}
  ]
}
```

## 4. 금지 사항

- "should work", "looks correct", "appears to handle X" 같은 추측 표현 금지 (P5)
- 한 story의 fail이 다른 story의 fail로 전이된다고 가정 금지 (각각 독립 평가)
- verifier가 직접 코드 수정 시도 금지 — fix는 `request_for_lead`로 위임

## 5. 참고

- 핵심 원칙 P5 (검증 없이 완료 선언 금지)
- `knowledge/decisions/agent-spawning-rules.md` (request_for_lead 형식)
- 설계: `docs/design/orchestrator-v2.md` §5.2
