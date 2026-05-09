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

## Vault Decision 인용 (언제든)

이 스킬은 **`/plan`과 마찬가지로 Vault decision을 자유롭게 인용**할 수 있다. 별도의 정해진 시점 없이 다음 상황에서 즉시 `mcp__vault-decision__advise` 또는 관련 도구를 호출:

- Step 0에서 *test seam·real vs mock 결정*에 동일 영역 기존 결정이 있을 때
- Step 1에서 behavior 표현·경계 결정 시 (예: "401/403 구분 정책")
- Step 3 RED→GREEN 도중 *구현 방식* 결정 시 (예: "비관적 락 vs 낙관적 락")
- Step 4 refactor에서 *모듈 경계·네이밍* 결정 시
- 가정 흔들림 → `/plan` 재진입 직전 (재진입 비용 회피용 마지막 점검)

인용 시 결과를 `features/<feature-name>/decisions.md` 또는 `pending-decisions.md`에 출처와 함께 기록한다. 같은 결정을 두 번 토론하지 않는다.

> 인용은 **권리**이지 의무가 아니다. 슬라이스 진행을 막을 만큼 무겁지 않은 결정이면 굳이 호출하지 않는다.

## 6단계 워크플로우

### Step 0 — 슬라이스 Scope 선언 (필수, behaviors 전)

이 슬라이스가 **무엇을 테스트로 보장하고 무엇을 보장하지 않는가**를 4항목 모두 채운 뒤에야 Step 1로 진입한다. 한 항목이라도 비어 있으면 진입 금지.

`features/<feature-name>/tdd-state.md`의 현재 슬라이스 섹션 첫 블록에 기록:

```markdown
## Slice #N — [tracer bullet 한 줄]

### Scope
- **In-scope** (테스트로 보장):
  - 어떤 layer까지 (예: Controller → Service → Repository → real DB)
  - 어떤 외부 경계 (예: 결제 API는 wiremock, 인증은 real)
- **Out-of-scope** (mock/stub으로 처리):
  - 결제 게이트웨이 응답 (wiremock)
  - 분산 락 (in-memory fake)
- **Test seam** (mocking 경계):
  - `PaymentClient` 인터페이스에서 wiremock 어댑터 주입
  - `Clock`은 fixed instant
- **Non-goal** (이 슬라이스에서 명시적으로 다루지 않음):
  - 동시성·race condition (다음 슬라이스)
  - 성능·부하 (해당 슬라이스 별도)
```

> **목적**: 외부에서 *"이번 슬라이스가 무엇을 보장하는가"* 가 한눈에 보이도록. handoff·takeover가 이 블록을 그대로 인용해 다음 세션에 전달.

> **반례 차단**: scope 선언 없이 behaviors만 적으면 "어디까지 real로 검증하나" 가정이 사람마다 달라져 GREEN의 의미가 흔들린다.

### Step 1 — Behaviors 나열 (코드 짜기 전)

선택된 슬라이스의 behavior 3-5개를 한국어로 먼저 작성. `features/<feature-name>/tdd-state.md`에 기록.

> **파일 처리**: `tdd-state.md`가 **없으면 이 스킬이 생성**한다 (plan은 만들지 않음). 있으면 현재 슬라이스 섹션을 갱신·확장한다 (이전 슬라이스 진행 기록은 보존).

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

### Step 5.5 — 슬라이스 완료 시 TODO.md 한 줄 제안 (사용자 확인)

해당 슬라이스의 모든 behavior가 GREEN + verification 통과 시점에서, `features/<feature-name>/TODO.md`의 *해당 슬라이스 항목 한 줄*을 체크하는 변경을 사용자에게 제안한다.

```
[TODO.md 변경 제안: features/<feature-name>/TODO.md]
- [x] Slice #N: [tracer bullet 설명]   ← 체크 후보

적용하시겠습니까? (y/n)
```

- `y` → tdd가 직접 한 줄만 수정.
- `n` → 건너뜀. 다음 `/handoff` 시점에 일괄 동기화.
- **자동 수정 금지** — 반드시 사용자 확인 후. 다른 항목·구조 변경은 절대 하지 않음 (그건 handoff의 역할).

세션 종료 시 `/handoff` 명시 호출 → `features/<feature-name>/TODO.md` 일괄 동기화 + `.claude/handoff/` 세션 dump 생성. 다음 세션은 `/takeover`로 인수.

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

## Slice #N — [tracer bullet 한 줄]

### Scope
- **In-scope** (테스트로 보장): ...
- **Out-of-scope** (mock/stub): ...
- **Test seam** (mocking 경계): ...
- **Non-goal**: ...

### Behaviors
- [x] behavior1   (RED→GREEN done)
- [x] behavior2
- [ ] behavior3   ← CURRENT
- [ ] behavior4

### Cited decisions (vault·local)
- vault: `Decision - 비관적 락 정책` → 비관적 락 채택
- local: `decisions.md#L20-30`

Last cycle: [timestamp]

---

## Slice #(N+1) — ...
(다음 슬라이스 진입 시 추가, 이전 슬라이스 블록은 보존)
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

## 상태 갱신 책임 매트릭스 (4개 자산 공통)

이 표는 plan / tdd / handoff / takeover 4개 자산이 모두 동일하게 따른다.

| 파일 | 생성 | 갱신 | 읽기만 |
|------|------|------|--------|
| `slices.md` | plan | plan (재진입 시 overwrite/append/abort 선택) | tdd, handoff, takeover |
| `tdd-state.md` | **tdd** (없으면 생성) | tdd (RED→GREEN 사이클마다) | handoff, takeover |
| `TODO.md` | plan | handoff (사용자 확인 후 일괄), tdd (슬라이스 완료 시 한 줄 제안 y/n) | takeover |
| `pending-decisions.md` | tdd (필요 시) | tdd | plan, handoff, takeover |
| `decisions.md` | 사용자/plan | plan, tdd | handoff, takeover |

이 매트릭스를 벗어난 수정은 금지. 특히 takeover는 어느 파일도 수정하지 않는다.

## Anti-Patterns

- ❌ Scope 4항목 없이 behaviors 작성 시작 (Step 0 강제 위반)
- ❌ "real DB까지 검증한다고 생각했는데 사실 mock"처럼 가정이 사람마다 다름
- ❌ Behavior 리스트 없이 바로 코딩
- ❌ 테스트 미리 다 작성 후 일괄 구현
- ❌ private 메서드 / 호출 횟수 검증
- ❌ 증거 없는 완료 주장
- ❌ horizontal slice (모든 schema → 모든 API → ...)
- ❌ 가정 흔들림에도 강행
- ❌ TODO.md를 슬라이스 한 줄 외 다른 부분까지 수정 (그건 handoff의 역할)
- ❌ 같은 영역 vault decision을 인용하지 않고 처음부터 토론 (재질문 회피 원칙 위반)
