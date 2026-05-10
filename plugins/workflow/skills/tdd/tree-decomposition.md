# 트리 형식 태스크 분해 (옵션)

복잡한 슬라이스에서 한 behavior가 여러 sub-step을 요구할 때 들여쓰기로 트리를 구성할 수 있다. 단순 슬라이스는 평면 리스트로 충분.

본 문서는 tdd 스킬 본문에서 분리되었다. 평면/트리 선택 표는 SKILL.md에 남겨둔다.

## 트리 조작 규칙

1. **leaf 추가 권한은 tdd만** — 사용자가 직접 추가하지 않는다 (워크플로우 일관성).
2. **추가마다 사용자 y/n 확인 필수** — `[제안] B2 아래에 자식 노드 "guard throws InvalidStateException" 추가. (y/n)`. 자동 추가 금지.
3. **부모 자동 GREEN** — 자식이 모두 `[x]`되면 부모도 즉시 `[x]`로 표시 (수동 체크 불필요).
4. **leaf가 더 잘게 쪼개지면 부모로 변환** — 자식 추가 시 leaf 자체는 *논리 부모*가 됨. RED→GREEN 사이클은 새 leaf로 이동.
5. **삭제 금지** — 부정확하게 추가한 노드는 `~~취소선~~` + 이유 주석. 실제 삭제는 사용자 직접.
6. **깊이 5 초과 시 경고** — *"이 슬라이스가 plan 슬라이스로 분리될 만큼 큰 신호. `/plan` 재진입을 고려하시겠습니까?"* 경고 후 사용자 판단. 강제 차단은 아님.

## 트리 구조 예시

```markdown
### Behaviors (트리)
- [x] B1. user can cancel a PENDING order
  - [x] cancel endpoint accepts orderId
  - [x] state transitions PENDING → CANCELED
    - [x] CancelService.cancel() returns updated order
    - [x] OrderRepository.save persists CANCELED state
  - [x] audit log written
- [ ] B2. canceling a CANCELED order returns 409  ← CURRENT
  - [ ] state guard checks current status
    - [ ] guard throws InvalidStateException
  - [ ] handler maps to 409
  - [ ] no audit log on rejection
```

## RED→GREEN과의 관계

- 트리에서는 **leaf 노드가 사이클 단위** (= "1 leaf = 1 cycle"; `red-green.md` 참조).
- 중간 노드는 자식 모두 GREEN 시 자동 GREEN.
- leaf가 도중에 부모로 승격되면, 새로 추가된 자식 leaf로 사이클 이동.
