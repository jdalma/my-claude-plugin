# Behavior 추출·식별 5원칙

> 출처: mattpocock `tdd` 핵심 원리 + SP TDD 디시플린 종합
> 적용: slice-tdd 스킬 Step 1 (behavior 리스트 작성)

## 정의

**Behavior** = 사용자/호출자가 *관찰* 가능한 시스템의 효과. 한 줄로 명세 가능한 단위.

테스트 1개 = behavior 1개 = RED→GREEN 사이클 1회.

> **트리 형식에서의 적용**: 평면(flat)이든 트리든 **모든 노드(leaf·중간·root)가 5원칙을 동일하게 충족**해야 한다. 부모 노드도 한 줄 명세·관찰 가능 효과를 갖는 behavior여야 하며, 단순히 자식들을 묶는 *카테고리 라벨*이 되어서는 안 된다. RED→GREEN 사이클은 **leaf 단위**로 돈다 (`red-green.md` 참조).

## 5원칙 (모두 충족해야 진짜 behavior)

### ① What, not How

| ✅ Behavior | ❌ Implementation |
|-----------|-----------------|
| "user can checkout with valid cart" | "OrderService.process() called once" |
| "canceling CANCELED returns 409" | "OrderState transitions correctly" |
| "expired token rejected" | "TokenValidator.check() returns false" |

테스트 이름을 읽었을 때 **시스템이 무엇을 하는가**가 한 줄로 떠올라야 함.

### ② Public Interface Only

private 메서드 직접 호출 → 안티패턴.
DB/캐시 직접 조회로 검증 → 안티패턴.

**검증 경로**:
- API endpoint
- public 메서드
- UI 인터랙션
- 외부에서 관찰 가능한 출력

### ③ Refactor Survive

내부 구조 변경(메서드 이름, 파일 분리, 클래스 추출)에 테스트 깨지지 않아야 함.

**자가 점검**: "이 함수 이름 바꾸면 테스트 깨지나?" → 깨지면 implementation 테스트.

### ④ Specification 같음

테스트 이름을 보고 *명세서*를 읽는 느낌이어야 함.
- "user can cancel a PENDING order" ← 명세
- "test_cancel_method_returns_object" ← 코드 구조

### ⑤ User-Facing

관찰 가능한 효과:
- 응답 변화
- 상태 전이
- 외부 시스템 호출 (이메일 전송 등)
- UI 변화

비-User-facing 예:
- "캐시 hit"
- "쿼리 N번 실행"
- "내부 큐에 들어감" (단, 외부에서 관찰 불가하면)

## Behavior 추출 절차

슬라이스 1개를 받았을 때:

1. 슬라이스 demoable을 한 줄로 표현
2. 그 demoable을 *행동*으로 분해 (3-5개)
3. 각 행동에 5원칙 적용 자가 점검
4. 5원칙 위반하는 항목 → 재작성 또는 제거
5. dependency 순서로 정렬 (tracer bullet이 첫 번째)

## 예시 — "PENDING → CANCELED" 슬라이스

**Bad (implementation 섞임)**:
```
1. OrderService.cancel() exists
2. OrderState transitions correctly
3. DB query executes
4. Cancel event is published
5. Audit log entry created
```

**Good (behavior 만)**:
```
1. user can cancel a PENDING order              [tracer]
2. canceling a CANCELED order returns 409
3. canceling another user's order returns 403
4. cancel timestamp is recorded                  (관찰: 응답에 포함)
5. cancel event triggers notification            (관찰: 외부 effect)
```

→ 5개 모두 *외부에서 관찰 가능*. 내부 구조 바뀌어도 살아남음.

## Behavior 우선순위 결정

코드 짜기 전 사용자에게 묻거나 자율 판단:

> "이 5개 중 어느 게 가장 중요? 어느 게 critical path?"

답에 따라 tracer bullet (1번)이 결정됨.

**You can't test everything.** 모든 엣지케이스 X. 임계 경로 + 복잡 로직에 집중.

## 안티패턴

- ❌ 5개 미리 다 작성 후 일괄 코딩 (horizontal)
- ❌ "OrderService.save() called once" (mock 검증)
- ❌ "DB에 INSERT 실행됨" (구현 디테일)
- ❌ "성공적으로 처리됨" (모호함)
- ❌ private 메서드 호출 검증
- ❌ 응답 구조의 *모양*만 검증 (값·효과 X)
- ❌ 트리의 부모 노드를 단순 카테고리 라벨로 사용 (예: "Validation 관련", "Persistence 관련" — 5원칙 위반)
