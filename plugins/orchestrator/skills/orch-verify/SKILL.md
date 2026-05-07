<!--
Origin: oh-my-claudecode v4.13.1, skills/verify/SKILL.md
Copied: 2026-04-21
Modifications:
  - 우리 Phase 4 Verification 절차로 통합
  - "should work" 거짓말 방어 룰 강화
  - verifier 에이전트가 따르는 증거 강도 계층 정의
License: MIT (원본 동일)
-->

---
name: orch-verify
description: Phase 4 verifier가 변경사항이 실제로 동작하는지 증거 기반으로 판정할 때 따르는 절차. P5 원칙(검증 없이 완료 선언 금지)의 운영 정의
trigger: lead-only (Phase 4 verifier 호출 시 절차로 참조)
---

## 1. 목적

Phase 4에서 verifier가 "정말로 작동하는가?"를 판정할 때, 추측이 아닌 **증거**로만 판정한다. P5 원칙의 운영 정의.

## 2. 호출 주체

**Lead만 호출**. verifier는 이 스킬을 자기 절차로 내장.

## 3. 증거 강도 계층

높을수록 강한 증거. 가능한 한 상위 증거를 수집한다.

| Tier | 증거 | 예시 |
|---|---|---|
| 1 (최강) | Controlled reproduction | 실제 시나리오 실행, 응답 캡처 |
| 1 | Test suite output | `npm test` 실패/성공 출력 |
| 1 | Build output | `npm run build`, `cargo build` 출력 |
| 2 | Static analysis pass | typecheck, lint, schema validation 통과 |
| 3 | LSP diagnostics 0 | 코드 분석 도구의 에러/경고 없음 |
| 4 (최약) | Code reading | 코드 읽고 "맞는 것 같다" |
| 금지 | Speculation | "should work", "appears correct", "I think" |

Tier 1을 1개 이상 확보 못하면 verdict는 `inconclusive` 또는 `fail`.

## 4. 절차

### Step 1 — 검증 대상 파악

`tasks.json`에서 status가 `REVIEW`인 태스크 + acceptance criteria 추출.

### Step 2 — 증거 수집 (Tier별)

Tier 1부터 시도:
1. 빌드 명령 실행 (Bash)
2. 테스트 명령 실행 (Bash)
3. 실제 시나리오 실행 (가능한 경우)

Tier 1을 못 쓰는 경우 (예: UI 변경 검증) Tier 2~3으로 보강하되, 한계를 `verdict_caveat`에 명시.

### Step 3 — Story-by-story 판정

`orch-ralph` 스킬과 같은 절차로 각 태스크별 verdict 부여.

### Step 4 — 결과 작성

```json
{
  "task_id": "task-verify",
  "agent": "verifier",
  "status": "DONE",
  "summary": "전체 검증 결과 요약",
  "findings": [
    {
      "story": "task-001",
      "verdict": "pass",
      "tier_used": 1,
      "evidence": [...]
    },
    {
      "story": "task-005",
      "verdict": "inconclusive",
      "tier_used": 3,
      "evidence": [...],
      "verdict_caveat": "UI 변경이라 자동 테스트 불가. 수동 확인 필요"
    }
  ]
}
```

## 5. "should work" 방어 룰

다음 표현이 result.summary 또는 findings에 등장하면 **자체 reject** 후 재작성:
- "should work"
- "appears to handle"
- "looks correct"
- "I think this is fine"
- "probably works"

대안 표현:
- "tested via `npm test`, 5/5 passing"
- "build succeeds with `cargo build --release`"
- "manually confirmed via curl POST /api/X returning 200"

## 6. 한계 보고

검증 불가능한 항목은 **숨기지 말고** `verdict: inconclusive`로 명시 + `verdict_caveat`에 이유.

예: "이 UI 변경은 visual diff 도구가 없어 검증 불가. 시각 확인 필요."

## 7. 금지 사항

- 추측 표현 사용 (위 §5)
- 한계를 숨기고 pass로 판정
- 직접 코드 수정 (fix는 `request_for_lead`로 위임)

## 8. 참고

- 핵심 원칙 P5
- `orch-ralph` (story-by-story 절차)
- 설계: `docs/design/orchestrator-v2.md` §2.1 (Phase 4)
