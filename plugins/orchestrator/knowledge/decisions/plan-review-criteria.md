# Plan Review Criteria — Momus 검수 체크리스트 + critic과의 분리

## 결정

Phase 2.5에서 Momus는 plan.json 초안의 **실행 가능성**을 검수한다. critic과 역할을 분리하여 중복을 피한다.

### Momus 검수 체크리스트

각 항목은 plan.json의 모든 태스크에 대해 평가한다.

| 항목 | 점검 내용 | 위반 시 처리 |
|---|---|---|
| **REF-1** | 참조된 파일/심볼이 실제로 존재하는가 (Read/Grep으로 확인) | 해당 태스크 권고: "파일 X 미존재 — Research에서 확인 필요" |
| **DEP-1** | depends_on 그래프에 순환이 없는가 | **반려** (계획 재작성 필수) |
| **DEP-2** | depends_on에 명시된 태스크 ID가 plan 안에 실제로 존재하는가 | **반려** |
| **ASN-1** | 카테고리(`category`)와 assignee가 라우팅 테이블(설계 문서 §2.5.1)에 부합하는가 | 권고: "category=visual인데 assignee=backenddev. designer가 적합" |
| **GRA-1** | 태스크가 너무 거대하지 않은가 (단일 태스크에 7개 이상 파일 변경 예상 시) | 권고: "분해 제안: A/B/C 3개 태스크로" |
| **HRD-1** | hard_blocked 가능성이 명백한 태스크가 있는가 (외부 의존, 미정의 정책 등) | 권고: "X가 미정. Phase 0 triage에서 hard로 분류됐는지 확인" |

### 결과 형식

```json
{
  "task_id": "task-momus-review",
  "agent": "momus",
  "status": "DONE",
  "verdict": "approved" | "conditional" | "rejected",
  "summary": "검수 요약",
  "findings": [
    {
      "rule": "DEP-1",
      "severity": "error" | "warning" | "info",
      "task_ids": ["task-003"],
      "message": "task-003 → task-005 → task-003 순환 의존성"
    }
  ],
  "request_for_lead": []
}
```

- `verdict: "rejected"` → Lead가 planner를 재호출하여 plan 수정 (최대 2회 재시도)
- `verdict: "conditional"` → Lead가 권고를 plan에 반영하거나 Question Debt로 적립
- `verdict: "approved"` → Phase 3 진입

## critic과의 역할 분리

| 관점 | Momus | critic |
|---|---|---|
| 검수 시점 | Phase 2.5 (plan 확정 직후) | Phase 4 (산출물 완성 후) |
| 검수 대상 | plan.json 자체 | 산출물(코드/문서) + 산출물 간 일관성 |
| 검수 관점 | 실행 가능성 (file/symbol 존재, 의존성, 라우팅 적합성) | 누락, 반례, 리스크, 일관성, 보안 |
| 권한 | 읽기 전용 | 읽기 전용 |
| 중복 부분 | plan.json은 둘 다 읽지만 관점이 다름 | (위와 동일) |

**왜 분리했는가**: critic이 Phase 2.5에 들어오면 critic의 책임 범위가 비대해진다. critic은 "산출물의 품질"에 집중하고, Momus는 "계획의 기계적 검증"에 집중. 이로써 각 에이전트의 프롬프트가 짧고 명확해진다.

## 근거

- OMO `momus.ts` 페르소나(계획 검수 전담)를 차용
- 별도 에이전트로 둔 이유: 검수 항목이 mechanical(파일 존재 확인, 그래프 분석)이라 critic의 정성적 판단과 분리해야 일관성 확보

## 적용 범위

- Momus 에이전트의 결과 작성 시
- Lead가 plan.json 검수 결과를 처리할 때
- critic이 Phase 4에서 plan과 산출물을 비교할 때 (Momus 결과를 입력으로 받음)

## 관련 에이전트

- momus (주체)
- planner (반려 시 재호출 대상)
- critic (Phase 4에서 Momus 결과를 입력으로 사용)

## 참고

- `docs/design/orchestrator-v2.md` §2.3, §2.3.1
- 외부 차용: OMO `oh-my-openagent/src/agents/momus.ts`
