# Decision Dashboard Protocol — decisions.md 형식 + 답변 파서

## 결정

대표(사용자)와의 의사결정 채널을 표준화한다. Lead는 `decisions.md`를 누적 갱신하고, 대표는 번호 답변으로 응답한다.

## 1. 파일 위치

- 제출: `.orchestrator/runs/{run-id}/decisions.md`
- 답변: `.orchestrator/runs/{run-id}/decisions-reply.md` (또는 터미널에 직접 입력)

## 2. decisions.md 형식

```markdown
# Decisions Required — run-{id}

**최종 갱신**: 2026-04-21T14:30:00Z
**현재 Phase**: Implementation (진행 중)
**현재 Run 상태**: EXECUTING (실행 가능 태스크 잔여)
**대표 답변 형식**: `Q1: 2, Q2: a, Q3: 보류`

---

## Q1. 환불 기한 설정
**상태**: open | resolved | deferred
**맥락**: 결제 API 구현 중
**영향 범위**: payment 모듈, 고객 지원 프로세스
**현재 가정**: 7일 (confidence 0.75, source: metis)

1. **7일** — 가정 유지. 장점: 이미 구현됨. 단점: 업계 평균(14일)보다 짧음.
2. **14일** — 재구현 필요. 장점: 업계 표준. 단점: 부정 사용 위험.
3. **30일** — 재구현 필요. 장점: 고객 친화적. 단점: 매출 인식 지연.

**권고**: 2번. 이유: 업계 표준에 맞추는 것이 장기적으로 안전.

---

## Q2. ...
```

### 항목 기록 규칙

- Lead만 쓴다. 항목은 **누적 추가**하고 기존 항목 수정 금지
- 답변 도착 시 `**상태**` 줄을 `resolved` 또는 `deferred`로 갱신 (이게 유일한 수정 허용)
- 각 항목은 `Q{N}` 형식 헤더로 구분 (1부터 순차)
- 선택지는 번호 또는 알파벳

## 3. 답변 채널

대표는 **둘 중 하나**로 응답:

### 채널 A — 파일 작성

`.orchestrator/runs/{run-id}/decisions-reply.md`에 한 줄 또는 줄바꿈 분리:

```
Q1: 2
Q2: a
Q3: 보류
```

또는 한 줄 쉼표 구분:

```
Q1: 2, Q2: a, Q3: 보류
```

### 채널 B — 터미널 입력

다음 메시지에 위와 같은 형식 텍스트 포함.

## 4. 파서 명세

### 4.1 매칭 정규식

```
Q\s*(\d+)\s*:\s*([0-9a-zA-Z]+|보류|defer|skip)
```

### 4.2 정규화 규칙

- 대소문자 무시
- 공백 무시
- 토큰 매핑:
  - 숫자 (1, 2, 3, ...) → 해당 번호의 선택지
  - 알파벳 (a, b, c, ...) → 해당 번호의 선택지 (1=a, 2=b, ...)
  - `보류` / `defer` / `skip` → status: `deferred`

### 4.3 파싱 결과 적용

| 답변 | debt 처리 |
|---|---|
| 숫자/알파벳 → 선택지 N | 해당 debt의 `status: resolved`, `provisional_assumption`을 선택지 N의 내용으로 갱신 |
| 보류/defer/skip | 해당 debt의 `status: deferred`. 런 종료 시 summary.md에 미해결로 포함 |

### 4.4 파싱 실패 시

다음과 같은 경우 파싱 실패로 판정:
- 형식에 맞지 않는 자유 텍스트
- 존재하지 않는 Q 번호 참조 (예: Q99)
- 선택지 범위 초과 (예: Q1에 선택지가 3개인데 5번 선택)

**처리**: Lead가 사용자에게 재질문 한 줄 알림.

```
[DECISIONS] 답변 파싱 실패. 형식 예시: `Q1: 2, Q2: a, Q3: 보류`. 다시 알려주세요.
```

자유 텍스트의 LLM 파싱은 v2에서 도입하지 않음 (`docs/design/v3-todo.md` Q8 참조).

## 5. 갱신 타이밍

| 시점 | 동작 |
|---|---|
| Phase 경계 + 신규 hard debt 누적 시 | decisions.md에 항목 추가, 터미널에 알림 |
| decisions-reply.md 변경 감지 또는 사용자 텍스트 수신 시 | 파싱 → 적용 → 처리 결과를 status.json 갱신 |
| 런 종료 시 | decisions.md 최종화, summary.md에 deferred debt 포함 |

## 적용 범위

- Lead가 decisions.md를 작성할 때
- 대표가 답변할 때
- summary.md 작성 시 (deferred debt 표기)

## 관련 에이전트

- Lead (decisions.md 단독 writer + 답변 파서 운영)
- 모든 에이전트 (decisions.md를 직접 쓰지 않음 — request_for_lead에 위임 요청)

## 참고

- `docs/design/orchestrator-v2.md` §4
- `question-debt-classification.md` (어떤 debt가 decisions.md로 가는지)
