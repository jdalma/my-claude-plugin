---
name: tdd
description: TDD 구현 워크플로우 — behavior 리스트, tracer bullet, RED→GREEN 사이클, refactor, 검증. 활성 트리거 키워드는 'tdd', 'RED→GREEN', 'tracer bullet', 'features/<feature-name>/slices.md 픽업'. 워크플로우만 제공하며 실행 방식은 사용자 선택.
---

# TDD — Vertical Slice Implementation Skill

OMC 의존만. 다른 플러그인 의존 X (필요한 원칙은 번들 .md로 흡수).

## 활성 시점

- `/plan` 직후 슬라이스 픽업 시 자동
- 키워드: "tdd", "RED→GREEN", "tracer bullet", "features/<feature-name>/slices.md 픽업"
- 슬라이스 1개를 implementation으로 가져온다는 의도가 컨텍스트에 명확할 때

(description의 4개 키워드와 본문이 일치 — 광범위 키워드 false-positive 차단)

## 진입 전 사전 조건

- [ ] `features/<feature-name>/slices.md` 존재 (없으면 `/plan` 먼저 안내)
- [ ] 현재 작업할 슬라이스 1개 식별됨
- [ ] feature-name이 컨텍스트에서 명확 (불명확 시 사용자에게 확인)

## 5단계 워크플로우

### Step 1 — Behaviors 나열 (코드 짜기 전)

선택된 슬라이스의 behavior 3-5개를 한국어로 먼저 작성. `features/<feature-name>/tdd-state.md`에 기록.

**Behavior 5원칙** (`behaviors.md` 참조):
1. **What, not How** — *어떻게* 가 아닌 *무엇을*
2. **Public interface only** — private 메서드 호출 X
3. **Refactor survive** — 내부 변경에 무관
4. **Specification 같음** — 한 줄로 명세 가능
5. **User-facing** — 관찰 가능한 효과

**예시**:
```
✅ "user can cancel a PENDING order"
✅ "canceling a CANCELED order returns 409"
❌ "OrderService.save() called once"  ← implementation
❌ "DB query executes"                  ← how
```

### Step 2 — Tracer Bullet 선택

가장 단순한 종단간 경로 1개 선정. `slicing.md` 참조.

### Step 3 — RED→GREEN 사이클 (한 번에 1개)

`red-green.md`의 Iron Law 준수:

```
RED:    1개 behavior에 대한 실패 테스트 작성
        → 실행해서 *예상한 이유로* 실패하는지 확인
GREEN:  최소 코드로 통과
        → 다른 테스트 깨지지 않는지 확인
NEXT:   다음 behavior로 (사이클 1회 = behavior 1개)
```

🚫 **절대 금지**:
- 테스트 5개 미리 다 짜기 (horizontal slicing)
- 코드 먼저 짜고 테스트 나중
- "이번엔 그냥 빨리 가자" 합리화

### Step 4 — Refactor (모든 behavior GREEN 후)

**필수 조건**: 전체 GREEN 상태 유지. 하나라도 깨지면 즉시 복구.

체크리스트:
- [ ] 중복 추출
- [ ] 깊은 모듈로 합성 (작은 인터페이스 + 큰 구현)
- [ ] 도메인 어휘 일치
- [ ] 매 변경 후 테스트 실행

### Step 5 — Verification (완료 주장 전)

`verification.md`의 Gate Function 통과 필수:

```
1. IDENTIFY: 어떤 명령이 이 주장을 증명하는가?
2. RUN: 전체 명령 실행 (fresh, complete)
3. READ: 출력 + exit code + 실패 수 확인
4. VERIFY: 출력이 주장을 뒷받침하는가?
5. ONLY THEN: 완료 주장
```

증거 없는 완료 주장 = 거짓말.

선택적: `omc:verify` Skill 호출로 외부 검증 게이트 추가.

세션 종료 시 `/handoff` 명시 호출 → `features/<feature-name>/TODO.md` 동기화 + `.claude/handoff/` 세션 dump 생성. 다음 세션은 `/takeover`로 인수.

## 실행 방식 — 메뉴 (사용자 *명시* 선택 시에만)

이 스킬은 *워크플로우만* 명세한다. 자동으로 어느 실행기도 호출하지 않는다.

사용자가 명시적으로 *"ralph로 돌려줘"* 류 요청 시에만 다음 메뉴 참조:

| 방식 | 사용자가 이렇게 요청할 때 |
|------|------------------------|
| **수동** (기본) | 명시 요청 없음 — 그냥 RED→GREEN 진행 |
| **`omc:ralph`** | "이 슬라이스 ralph로 돌려" |
| **`omc:ultrawork`** | "behavior들 병렬로 돌려" |
| **`omc:autopilot`** | "슬라이스 전체 autopilot으로" |

🚫 **자동 escalate 금지** — LLM이 *"이게 적합해 보이니 ralph 호출"* 하면 안 됨.
📋 vault `OMC 스킬 역할별 화이트리스트` 결정 준수. 위험 도구 자동 호출은 명시적 차단 대상.

## 상태 관리

`features/<feature-name>/tdd-state.md`:
```markdown
# TDD Progress
Current slice: #N
Behaviors:
- [x] behavior1   (RED→GREEN done)
- [x] behavior2
- [ ] behavior3   ← CURRENT
- [ ] behavior4

Last cycle: [timestamp]
```

## 추가 태스크 발견 시 처리

작업 중 새 태스크/모호함 발견:
- 현재 슬라이스 *demoable* 안에 들어가면 → behavior에 inline 추가
- 슬라이스 외 → `features/<feature-name>/pending-decisions.md`에 노트, 슬라이스 종료 후 `/plan` 재호출
- 가정 자체 흔들림 → STOP, WIP 커밋, `/plan` 재진입

## Dependencies

**Hard**: 없음. 워크플로우 명세만 제공하므로 외부 도구 의존 X.

**Optional integrations** (사용자 명시 호출 시에만):
- `omc:verify` — Step 5 외부 검증 게이트 보강
- `omc:trace` — 디버깅 발생 시 가설 경쟁
- 실행기 4종 (수동/`omc:ralph`/`omc:ultrawork`/`omc:autopilot`)

⚠️ optional은 자동 호출 X. 사용자가 명시 요청할 때만 사용.

## 번들 문서

- `red-green.md` — RED-GREEN-REFACTOR 디시플린 (SP TDD 흡수)
- `verification.md` — Gate Function (SP verification 흡수)
- `slicing.md` — Vertical slice + tracer bullet 원칙
- `behaviors.md` — Behavior 추출·식별 5원칙

## Anti-Patterns

- ❌ Behavior 리스트 없이 바로 코딩
- ❌ 테스트 미리 다 작성 후 일괄 구현
- ❌ private 메서드 / 호출 횟수 검증
- ❌ 증거 없는 완료 주장
- ❌ horizontal slice (모든 schema → 모든 API → ...)
- ❌ 가정 흔들림에도 강행
