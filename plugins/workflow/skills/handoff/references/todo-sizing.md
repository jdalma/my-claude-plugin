# TODO 항목 크기 가이드 (task-index.md TODO 섹션)

## 핵심 명제

**task-index.md TODO 섹션 항목 1개의 크기 = handoff 1회로 깔끔하게 떨어지는 작업 단위.**

> 본 가이드는 task-index.md의 *TODO 섹션* — 슬라이스 외 작업·잡일·외부 의존 대기 — 에 적용된다. 슬라이스 자체의 분해 가이드는 `tdd/SKILL.md`의 분기 룰(트리 vs `/plan` 재진입)을 참조.

이 등식이 깨지면(항목이 너무 크거나 작으면) 다음이 연쇄적으로 망가진다:

- 항목이 너무 크면: handoff Key Decisions/Traps이 폭증 → 다음 세션 검증 비용 폭발
- 항목이 너무 작으면: handoff 오버헤드 > 작업 가치
- 한 항목 도중 컨텍스트 압박 → 작업 도중 끊어야 함 → handoff가 "절반 완료"로 떠짐
- 검증 기준 없는 항목 → takeover가 "진행 중"인지 "완료"인지 판단 불가

→ **TODO 항목 크기 = 시스템 전체 품질의 상류 결정 요소.**

## 좋은 항목 / 나쁜 항목

### ❌ 너무 큰 항목 (1세션에 못 끝남)

```markdown
- [ ] Payment MSA 분리                              # 며칠/몇 주짜리 epic
- [ ] OAuth 시스템 리팩터                           # 결정 5개+, 파일 20개+
- [ ] 사용자 인증 전체 개선                         # 범위 모호
```

문제: 한 항목에 결정·실패·파일이 너무 많이 쌓여 handoff가 의미를 잃는다.

### ❌ 너무 작은 항목 (오버헤드 > 가치)

```markdown
- [ ] PaymentService.kt:L45 변수명 fix
- [ ] import 정리
- [ ] 오타 수정
```

문제: 항목당 handoff 비용이 작업 자체보다 크다. TODO에 올릴 가치 없고, 그냥 작업하면 된다.

### ✅ 적절한 항목 (handoff 1회로 깔끔)

```markdown
- [ ] OAuth refresh를 TX 밖으로 이동 (PaymentService.refresh)
  - 검증: TestPaymentRefresh.testRefresh가 그린
  - Out of scope: race condition 처리 (별도 항목)

- [ ] race condition 재현 테스트 작성 (TestPaymentRefresh.testConcurrent)
  - 검증: 테스트가 빨강 (재현 성공)
  - Out of scope: 실제 lock/CAS 구현

- [ ] race condition 해결: lock vs CAS 결정 + 구현
  - 검증: TestPaymentRefresh.testConcurrent가 그린
  - Out of scope: outbox 도입
```

각 항목이 **2-4시간 ~ 1세션 분량**, **결정 1-2개**, **파일 3-6개** 안에 떨어진다. handoff가 깔끔하게 닫힌다.

## 항목 작성 시 체크리스트

항목을 적기 전에 다음을 자문한다:

1. **이 항목 1개를 한 세션에 끝낼 수 있나?**
   - "끝낸다"의 정의: 검증 가능한 상태로 완료, 또는 명확히 막혀서 다음 항목으로 넘김
   - No → 더 쪼갠다

2. **이 항목의 "완료" 기준이 검증 가능한가?**
   - "OAuth 개선" ❌ vs "TestRefresh.testRefresh가 그린" ✅
   - 검증 기준이 모호하면 → 검증 가능한 sub-task로 분해

3. **이 항목을 하면서 결정이 몇 개 나올 것 같은가?**
   - 1-2개 → 적절
   - 3개 이상 예상 → 결정별로 항목 분리

4. **외부 의존이 있는가?**
   - "백엔드 PR 머지 대기" 등 → 그건 항목이 아니라 **Blocked By**. 의존이 풀린 후의 작업만 항목으로 쓴다.

5. **다른 항목과 쪼갤 수 있는 자연스러운 경계가 있는가?**
   - 있는데 안 쪼갠 상태라면 → 쪼갠다

## 권장 task-index.md 구조 (TODO 섹션 + 인접 섹션)

```markdown
---
feature_name: payment-msa
---

# Task Index — Payment MSA 분리

## Slices (dependency order)
- [x] 1. **TX 외부 호출 분리** ...
- [~] 2. **race condition 재현 + 해결** ... (CURRENT, tdd-state/slice-2.md)
- [ ] 3. **outbox 구조 도입** ...

## TODO (slice 외 작업·잡일·외부 의존 대기)
- [ ] PaymentService 통합 테스트 도커 fixture 정리
- [ ] OMS 팀의 Kafka 토픽 명세 대기 (별도 PR #234)
- [x] 패턴 X·Y 프레임워크 결정 인용 (ADR-0042)

## Decisions / Traps (수명 긴 메모)
- 결정: Hazelcast 캐시 폐기 (cluster sync 비용)
- 함정: TX2를 동기 chain으로 묶지 말 것 → DB lock 점유 증가
```

### 섹션별 역할과 스킬 연계

| 섹션 | 역할 | 갱신 주체 | handoff/takeover와의 관계 |
|------|------|-----------|------------------------|
| Slices | slice 정의 + 진행 마커(`[ ]/[~]/[x]/[!]`) | plan(생성), tdd(마커 토글) | takeover가 수평 진행도 즉시 파악 |
| TODO | slice 외 작업·외부 의존 대기·잡일 | handoff (사용자 y/n 후 일괄) | handoff의 Candidate Next Action과 매칭 |
| Decisions / Traps | 수명 긴 메모 | plan, tdd | handoff의 Key Decisions / Traps가 여기로 승격 |

> **WIP 단일 룰**: 한 시점에 `[~]` 마커는 1개만 (Slices 섹션). 멀티 WIP 금지. takeover가 첫 보고에 명시.

## 안티 패턴

| 패턴 | 왜 나쁜가 |
|------|---------|
| 단일 항목에 sub-task 인라인 (`- [ ] X (with A, B, C, D, E)`) | 부분 완료 추적 불가 |
| WIP 항목 3개 이상 | 컨텍스트 분산. 작업 단위 1개에 집중 못 함 |
| 검증 기준 없는 항목 | "완료"의 정의가 사람마다 다름. handoff 자동 체크 위험 |
| 며칠짜리 항목 ("이번 주에 X 끝내기") | 한 세션의 작업 단위 아님. epic이지 todo 아님 |
| 완료된 항목 즉시 삭제 | history 손실. takeover가 stale 판정에 못 씀. 취소선이나 별도 Done 섹션 사용 |

## 분할이 필요한 신호 (handoff 시점에 발견)

handoff를 작성하다가 다음 중 하나라도 발생하면 **TODO 항목(또는 슬라이스) 자체가 너무 컸다**는 신호다:

- handoff Key Decisions이 3개를 초과
- Traps to Avoid가 5개를 초과
- Relevant Files가 8개를 초과
- 작업이 끝나기도 전에 컨텍스트가 답답해짐
- tdd-state/slice-N.md의 트리 깊이가 5 초과 (슬라이스 자체가 너무 큰 신호)

이런 신호가 반복되면 다음 사이클에서 TODO 항목을 더 작게 쪼개거나, 슬라이스를 `/plan` 재호출로 분리하는 것이 본질적 해결이다. 컨텍스트 70% 같은 매직 넘버에 의존하지 않는다.
