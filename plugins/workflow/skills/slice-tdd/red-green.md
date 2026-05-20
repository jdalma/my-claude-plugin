# RED-GREEN-REFACTOR 디시플린

> 흡수 출처: `superpowers:test-driven-development`
> 적용: slice-tdd 스킬 Step 3

## Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

테스트 없이 짠 코드 → **삭제**. 다시 시작.

**예외 없음**:
- "참고용으로 남겨두기" 금지
- 테스트 보면서 "각색" 금지
- 보지도 마라
- 삭제는 진짜 삭제

테스트로부터 다시 구현.

## 사이클의 단위 — leaf 1개 = cycle 1회

평면이든 트리든 **사이클 단위는 항상 leaf**.

| 형식 | 사이클 단위 |
|------|-------------|
| 평면 | behavior 1개 = leaf = 1 cycle |
| 트리 | leaf 노드 1개 = 1 cycle |

**중간·부모 노드는 직접 사이클을 돌지 않는다.** 자식 leaf들이 모두 GREEN되면 부모가 *자동으로* GREEN으로 표시된다 (수동 체크 불필요). 부모를 수동으로 체크하지 않는다.

**leaf가 도중에 자식을 가지면**: 그 leaf는 부모로 승격되고, 새 leaf로 사이클이 이동한다. 승격된 부모의 GREEN/RED 상태는 새 자식들의 결과로 자동 결정된다.

## Core Principle

> 실패 *과정*을 보지 못했다면 그 테스트가 *옳은 것을 검증하는지* 알 수 없다.

## RED — Failing Test 작성

1개 behavior에 대한 최소 테스트 작성.

**Good RED**:
```typescript
test('retries failed operations 3 times', async () => {
  let attempts = 0;
  const operation = () => {
    attempts++;
    throw new Error('fail');
  };
  await expect(retry(operation, 3)).rejects.toThrow();
  expect(attempts).toBe(3);
});
```

**Verify**: 테스트 실행 → *예상한 이유로* 실패하는지 확인.
- 실패 메시지가 "함수 없음" → OK
- 실패 메시지가 다른 이유 → 테스트 잘못 작성됨, 수정 후 재실행

## GREEN — Minimal Code

테스트 통과에 필요한 *최소* 코드만.

**규칙**:
- 다음 테스트를 위한 코드 X
- 미래 케이스 미리 처리 X
- "어차피 필요할 거" 추측 X
- 현재 RED 1개만 GREEN으로

**Verify**: 전체 테스트 실행 → 모든 GREEN 확인. 다른 테스트 깨지면 GREEN으로 복구 후 진행.

## REFACTOR — 모든 GREEN 후

조건: **전체 테스트 GREEN 상태 유지**.

체크리스트:
- [ ] 중복 추출
- [ ] 깊은 모듈로 합성 (작은 인터페이스 + 큰 구현)
- [ ] SOLID 자연스러운 적용
- [ ] 새 코드가 기존 코드에 주는 통찰
- [ ] **매 단계 후 테스트 실행**

🚫 **RED 상태에서 리팩터 절대 금지**. GREEN 먼저.

## Cycle 다이어그램

```
RED 작성 ──→ 실패 확인 ──→ GREEN 코드 ──→ 통과 확인 ──→ 다음 RED
   ▲              │             ▲              │
   │              │             │              ▼
   │          잘못된 실패        │         REFACTOR
   └──────────────┘             │              │
                                └──────GREEN 유지─┘
```

## 안티패턴 — 즉시 중단 신호

| 안티패턴 | 대응 |
|---------|------|
| "테스트 5개 다 짜고 구현" | STOP — 1개씩 |
| "코드 먼저 짜고 테스트 만들자" | 코드 삭제, 테스트부터 |
| "이번엔 그냥 빨리" | 합리화. 멈춰라 |
| RED 본 적 없는 GREEN | 테스트 진짜 실패하는지 확인 |
| GREEN인데 다른 테스트 깨짐 | 즉시 복구, 다음 단계 X |
| RED 상태에서 리팩터 | GREEN 먼저, 그다음 리팩터 |
| 부모 노드를 직접 RED→GREEN 시도 | leaf로 분해하거나, 5원칙 위반 시 노드 삭제 |
| 부모를 수동 체크 | 자식 모두 GREEN이면 자동 GREEN. 수동 체크 금지 |
