# Failure Recovery — 에이전트/파일/세션 실패 복구 정책

## 결정

런 실행 중 발생할 수 있는 실패 모드별로 명시적 복구 절차를 정의한다.

## 1. 에이전트 spawn 실패

| 실패 유형 | 재시도 | 최종 처리 |
|---|---|---|
| Metis API 오류/타임아웃 (Phase 0) | 2회 | skip → triage.json 비어 있는 채로 진행. 모든 debt는 각 에이전트가 자체 분류 |
| Momus API 오류/타임아웃 (Phase 2.5) | 2회 | skip → critic이 Phase 4에서 plan을 추가 검토 (보강 fallback) |
| 일반 에이전트 (planner/backenddev/appdev/designer) | 2회 | 해당 태스크 HARD_BLOCKED + `failure_reason` 필드에 사유 기록 |
| critic | 2회 | Lead가 직접 정합성 검토 (제한된 범위) + Question Debt에 "critic 미실행" 항목 적립 |
| verifier | 2회 | Lead가 빌드/테스트를 직접 실행 (Bash 도구). 결과를 verifier-result.json 형식으로 기록 |

재시도 간격: 즉시 (지수 백오프 도입은 v3에서 검토).

## 2. 결과 파일 손상

Lead가 `agents/{name}-result.json`을 읽을 때 다음이 발생하면 손상으로 판정:
- JSON 파싱 실패
- 필수 필드 누락 (schema validation 실패)
- 파일 사이즈 0 또는 비어 있음

### 처리 절차

1. 손상된 파일을 `agents/{name}-result.corrupt-{timestamp}.json`으로 보존 (포렌식 용)
2. 해당 에이전트를 1회 재호출 — 재생성 요청
3. 재생성 결과도 손상이면 해당 태스크 HARD_BLOCKED + decisions.md에 항목 추가
4. 손상 사유는 `failure_reason` 필드에 기록 ("result file repeatedly corrupted")

## 3. Lead 세션 중단 (context compaction / 사용자 종료)

### 3.1 중단 시점

- Claude Code의 자동 context compaction 발생 시
- 사용자가 터미널 닫음 / Ctrl+C
- API 오류로 메인 세션 중단

### 3.2 상태 보존

- 매 Phase 진입/종료 시 `status.json`이 갱신되므로 중단 시점이 자동 기록됨
- `tasks.json`의 RUNNING 상태 태스크는 미완료로 간주

### 3.3 재개 (resume) 절차

새 Claude Code 세션에서 사용자가 `run-{id} resume`을 요청하면:

1. Lead가 `status.json`을 읽어 마지막 Phase 확인
2. `tasks.json`에서 `RUNNING` 상태 태스크를 모두 `READY`로 되돌림 (재실행 가능 상태)
3. `READY` 상태 태스크부터 spawn 재개
4. Phase는 status.json의 `current_phase`부터 이어서 진행

### 3.4 idempotent 요구사항

resume 시점에 모든 RUNNING 태스크가 무조건 재실행되므로, **에이전트는 idempotent**해야 한다:
- 같은 입력으로 두 번 실행해도 결과·부작용이 1회 실행과 동일
- 파일 작성 시 append가 아니라 overwrite (또는 idempotent merge)
- 외부 부작용(API 호출, DB 쓰기)은 멱등성 키 사용 권장

각 에이전트 템플릿에 "idempotent 강제" 조항을 명시.

## 4. WAITING_USER 상태의 TTL

### 4.1 자동 만료

- WAITING_USER 상태 진입 시각을 `status.json`에 기록
- 30일 경과 시 Lead가 자동 처리:
  - 해당 런의 `summary.md`에 "MISSED_DEADLINE" 표시
  - 모든 미해결 debt를 `deferred`로 전환
  - Run 상태를 DONE으로 변경
  - `status.json`에 `expired: true, expired_at: <timestamp>` 기록

### 4.2 새 런 시작 시 알림

WAITING_USER 상태인 런이 1개 이상 있는 상태에서 사용자가 새 런을 시작하면:

```
[WARN] WAITING_USER 런 N개 존재.
  - run-20260415-103000 (10일 경과, 미해결 Q 3개)
  - run-20260418-141500 (3일 경과, 미해결 Q 1개)
ls .orchestrator/runs/ 로 확인.
새 런을 시작하시겠습니까? (y/N, 기본값 y)
```

자동 취소는 하지 않음 (대표 결정 Q9). 사용자가 명시적으로 취소하지 않으면 보존.

## 5. run-id 충돌

`run-YYYYMMDD-HHmmss` 형식은 초 단위. 같은 초에 두 런 시작 시 디렉터리 충돌 가능.

### 처리

- Lead가 디렉터리 생성 시 충돌 감지하면 `run-YYYYMMDD-HHmmss-2`, `-3` 식 suffix 부여
- Question Debt로 적립 ("run-id 충돌 발생, suffix 처리됨")
- 1인 사용 환경에서 발생 가능성 매우 낮음

## 적용 범위

- Lead의 모든 에이전트 호출 로직
- 결과 파일 처리 로직
- 새 세션 시작 시 resume 처리
- 새 런 시작 시 기존 런 상태 점검

## 관련 에이전트

- Lead (실패 복구의 단독 책임자)
- 전체 에이전트 (idempotent 강제 대상)
- critic (Momus 실패 시 보강 fallback)
- verifier (대상이 아닌 fallback 실행 주체 가능)

## 참고

- `docs/design/orchestrator-v2.md` §6.5
- `docs/design/v3-todo.md` (지수 백오프, Hashline 도입 등)
