---
name: slice-tdd
description: plan이 산출한 features/<feature-name>/task-index.md의 특정 슬라이스를 픽업해 구현하겠다는 의도를 사용자가 명시 호출했을 때만 사용 ("/slice-tdd", "슬라이스 #N 시작", "task-index.md 픽업"). Scope 선언 → behavior 리스트 → tracer bullet → RED→GREEN 사이클 → refactor → 검증의 6단계 워크플로우를 제공한다. task-index.md가 없거나 "테스트 짜줘"/"tdd로 가자" 같은 일반 의도뿐이면 자동 호출하지 말고 /plan을 안내한다. 자동 제안·자동 escalate·자동 git commit 금지.
disable-model-invocation: true
---

# slice-tdd — Vertical Slice Implementation Skill

OMC 의존만. 다른 플러그인 의존 X (필요한 원칙은 번들 .md로 흡수).

> 본 스킬은 이전 이름이 `tdd`였다. 트리거 충돌(다른 플러그인의 `tdd` 키워드/스킬과 겹침)을 피하기 위해 `slice-tdd`로 변경됨. 외부 문서·세션 메모에서 "tdd 스킬"이라는 표기가 보이면 이 스킬을 가리키는 것으로 해석한다.

## ⛔ 호출 규칙 (가장 중요)

이 스킬은 **사용자가 명시 호출했을 때만** 동작한다. 활성 조건 — 다음 중 하나라도 만족:
- `/slice-tdd` 슬래시 직접 호출
- "슬라이스 #N 시작" / "task-index.md 픽업" 같이 *특정 슬라이스를 가리켜* 구현 의도 명시 (단, `task-index.md`가 실재해야 함)

> **왜 명시 호출 전용인가**: slice-tdd는 `/plan`이 만든 `task-index.md`를 전제로 그 위에서 돈다. 전제 없이 일반 의도("테스트 짜줘", "tdd로 가자")나 키워드만으로 자동 발동하면 plan을 건너뛴 채 잘못된 분해 위에서 작업하게 된다. 그래서 전제가 없으면 활성하지 말고 `/plan`을 먼저 안내한다. 선제 권유("이 스킬 쓸까요?")도 하지 않는다.

## 진입 전 사전 조건

- [ ] `features/<feature-name>/task-index.md` 존재 (없으면 `/plan` 먼저 안내)
- [ ] 현재 작업할 슬라이스 1개 식별됨
- [ ] feature-name이 컨텍스트에서 명확 (불명확 시 사용자에게 확인)

## ⛔ 커밋 금지 원칙 (가장 중요 #2)

slice-tdd는 **어떤 단계에서도** `git commit` / `git add` / `git push`를 자동 실행하지 않는다 — 사용자가 명시적으로 "커밋해줘"라고 한 뒤 *Step 5.6 게이트*를 거쳤을 때만 실행한다. 자율 위임("알아서 해줘")으로도 해제되지 않는다.

> **이유**: RED→GREEN 사이클은 검수 안 된 부분 상태를 자주 만든다. 자동 커밋은 그 미검수 코드를 history에 박고 검수 흐름을 끊는다. 그래서 커밋 시점 판단은 항상 사람이 한다 — 이 한 가지 이유를 이해하면 "GREEN이니 커밋해두자" "refactor 끝났으니 커밋" 류 판단이 왜 전부 금지인지 자명하다.

세부 게이트는 *Step 5.6* 참조.

## Vault Decision 인용 (언제든)

이 스킬은 **`/plan`과 마찬가지로 Vault decision을 자유롭게 인용**할 수 있다. 별도의 정해진 시점 없이 다음 상황에서 즉시 `mcp__vault-decision__advise` 또는 관련 도구를 호출:

- Step 0에서 *test seam·real vs mock 결정*에 동일 영역 기존 결정이 있을 때
- Step 1에서 behavior 표현·경계 결정 시 (예: "401/403 구분 정책")
- Step 3 RED→GREEN 도중 *구현 방식* 결정 시 (예: "비관적 락 vs 낙관적 락")
- Step 4 refactor에서 *모듈 경계·네이밍* 결정 시
- 가정 흔들림 → `/plan` 재진입 직전 (재진입 비용 회피용 마지막 점검)

인용 시 결과를 `features/<feature-name>/task-index.md`의 `## Decisions` 섹션에 `[resolved][slice-<현재 슬라이스 번호>]` 표기와 출처(vault 경로 또는 grill 결과)로 기록한다. 같은 결정을 두 번 토론하지 않는다.

표기 예시:
- `[resolved][slice-2] 결제 환불 기한: 14일 (vault: Decision - 환불 기한)`
- `[trap][slice-1] FooService.refresh는 lock 없이 병렬 호출 시 race`

> behavior 단위(B1, B2.guard 등)는 출처에 넣지 않는다 — `tdd-state/slice-N.md`의 `## Cited decisions` / `## Cycle log`에 이미 자동 누적되므로 task-index.md에는 슬라이스 단위까지만 추적한다.

> 인용은 **권리**이지 의무가 아니다. 슬라이스 진행을 막을 만큼 무겁지 않은 결정이면 굳이 호출하지 않는다.

## 6단계 워크플로우

### Step 0 — 슬라이스 Scope 선언 (필수, behaviors 전)

이 슬라이스가 **무엇을 테스트로 보장하고 무엇을 보장하지 않는가**를 4항목 모두 채운 뒤에야 Step 1로 진입한다. 한 항목이라도 비어 있으면 진입 금지.

슬라이스 진입 시 `features/<feature-name>/tdd-state/slice-N.md`를 생성·갱신하며, 그 첫 블록에 Scope 4항목을 기록한다 (N = 슬라이스 번호). 첫 호출이면 `tdd-state/` 디렉토리도 함께 생성:

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

선택된 슬라이스의 behavior 3-5개를 한국어로 먼저 작성. `features/<feature-name>/tdd-state/slice-N.md`에 기록.

> **파일 처리**: 슬라이스마다 별도 파일. 없으면 이 스킬이 생성 (plan은 만들지 않음). 있으면 본문을 갱신·확장. 다른 슬라이스 파일은 건드리지 않는다 (독립성).

> **task-index 동기화**: 첫 호출(슬라이스 시작) 시점에 `task-index.md`의 해당 슬라이스 마커를 `[ ]→[~]`로 토글 (사용자 y/n 후만, 스킬 본문 *진행 마커 토글 룰* 참조).

> **형식 선택**: 단순한 슬라이스는 평면 리스트(`- [ ] behavior1`), 한 behavior가 자연스레 sub-step으로 쪼개지는 경우는 트리(들여쓰기). 자세한 트리 조작 규칙은 본 파일의 *"트리 형식 태스크 분해"* 섹션 참조.

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

Iron Law: **실패하는 테스트 없이 프로덕션 코드를 짜지 않는다.** 사이클 1회 = behavior(트리면 leaf) 1개 — RED 작성 → *예상한 이유로* 실패 확인 → 최소 코드로 GREEN → 다른 테스트 무사 확인 → 다음.

> 디시플린 전체(Good/Bad RED 예시, 사이클 단위, RED 상태 리팩터 금지)는 `red-green.md`. 핵심은 하나다 — *실패를 직접 보지 못한 테스트는 옳은 것을 검증하는지 알 수 없다.* 이 이유를 쥐고 있으면 "5개 미리 짜기" "코드 먼저" "이번만 빨리" 가 왜 전부 금지인지 따로 외울 필요가 없다.

### Step 4 — Refactor (모든 behavior GREEN 후)

전체 GREEN 유지가 전제 — 하나라도 깨지면 즉시 복구, 매 변경 후 테스트 실행. 중복 추출·깊은 모듈 합성·도메인 어휘 일치를 본다 (체크리스트·RED 상태 리팩터 금지는 `red-green.md`).

### Step 5 — Verification (완료 주장 전)

이번 메시지에서 검증 명령을 *직접 실행*해 그 출력(exit code·실패 수 포함)을 읽기 전에는 "완료"를 주장하지 않는다. 증거 없는 완료 주장은 검증 실패와 같다 — "통과할 것" "잘 됐을 듯"은 증거가 아니다. 5단계 Gate Function과 흔한 실패 표는 `verification.md`.

선택적: `omc:verify` Skill 호출로 외부 검증 게이트 추가.

### Step 5.5 — 슬라이스 완료 시 task-index.md 진행 마커 토글 (사용자 확인)

해당 슬라이스의 모든 leaf가 GREEN + verification 통과 시점에서, `features/<feature-name>/task-index.md`의 *해당 슬라이스 항목 마커*를 `[~]→[x]`로 토글하는 변경을 사용자에게 제안한다.

```
[task-index.md 변경 제안: features/<feature-name>/task-index.md]
- [x] Slice #N: [tracer bullet 설명]   ← [~]→[x] 토글 후보

적용하시겠습니까? (y/n)
```

- `y` → slice-tdd가 마커 한 글자만 수정.
- `n` → 건너뜀. 다음 `/handoff` 시점에 일괄 동기화.
- **자동 수정 금지** — 반드시 사용자 확인 후. Slices·TODO·Decisions 다른 항목·구조 변경은 절대 하지 않음.

#### 진행 마커 토글 룰 (task-index.md)

| 시점 | 변환 | 권한 | 확인 |
|------|------|------|------|
| 슬라이스 시작 (Step 0 진입 시) | `[ ]→[~]` | slice-tdd | y/n |
| 슬라이스 완료 (Step 5.5) | `[~]→[x]` | slice-tdd | y/n |
| 깊이 5 초과 또는 가정 흔들림 | `[~]→[!]` | slice-tdd | y/n + 사유 메모 |
| 다른 슬라이스로 전환 (현 슬라이스 미완) | 직전 `[~]` 유지, 새 슬라이스 `[ ]→[~]` | slice-tdd | y/n |

### Step 5.6 — 커밋 검수 게이트 (사용자 명시 요청 시에만)

🚫 **자동 진입 금지** — Step 5.5 통과 후에도 slice-tdd는 *자동으로 커밋을 만들지 않는다*. 사용자가 "커밋해줘" / "이거 커밋" 같이 *명시적으로* 요청했을 때에만 이 단계로 진입한다.

진입 시 5단계 게이트:

```
1. DIFF SUMMARY
   `git status --short` + `git diff --stat`을 실행해 변경 파일·라인 수 요약.
   (실행하지 않고 요약을 만들지 말 것.)

2. SCOPE CHECK
   변경 파일이 *현재 슬라이스 in-scope*에 들어맞는가? out-of-scope 파일이 끼었는가?
   - 이번 슬라이스 외 파일이 섞여 있으면 사용자에게 분리 여부 확인.

3. MESSAGE DRAFT
   커밋 메시지 초안을 제시. 형식은 기존 git log 컨벤션을 참고.
   - 슬라이스 #N + tracer bullet 한 줄 요약을 본문에 포함.
   - 작성만 한다. 적용은 다음 단계.

4. USER APPROVAL (y/n)
   "위 diff/메시지로 커밋할까요? (y/n)"
   - y → Step 5 실행
   - n → 사용자가 직접 수정 지시할 때까지 대기. slice-tdd는 다시 손대지 않음.
   - 다른 답변 → 게이트 중단, 사용자 의도 재확인.

5. COMMIT
   사용자 y/n이 y인 경우에만 `git add <명시된 파일들> && git commit -m "<승인된 메시지>"` 실행.
   - `git add -A` / `git add .` 금지 (실수로 의도하지 않은 파일을 staging).
   - `--no-verify` 금지.
   - push는 별도 명시 요청이 있을 때까지 *절대* 실행하지 않음.
```

🚫 **금지 행위**:
- ❌ Step 5 verification 통과 직후 사용자 확인 없이 커밋 메시지 생성·실행
- ❌ "이왕 GREEN인데 커밋해두자" 류 자체 판단
- ❌ refactor 후 자동 커밋
- ❌ diff를 보지 않은 채 커밋 메시지 작성 (반드시 `git diff` 실행 후 작성)
- ❌ 사용자 자율 위임 발언("알아서 해줘")으로 게이트 우회
- ❌ amend / force-push / `--no-verify` 사용

세션 종료 시 `/handoff` 명시 호출 → `task-index.md`의 *TODO 섹션* 일괄 동기화 + `.claude/handoff/` 세션 dump 생성. 다음 세션은 `/takeover`로 인수.

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

`features/<feature-name>/tdd-state/slice-N.md` (슬라이스마다 별도 파일):
```markdown
---
feature_name: <feature-name>     # task-index.md frontmatter에서 그대로 복사. takeover의 cross-branch 검증 키.
slice: N
tracer_bullet: [한 줄]
started: <date>
---

# Slice #N — [tracer bullet 한 줄]

## Scope
- **In-scope** (테스트로 보장): ...
- **Out-of-scope** (mock/stub): ...
- **Test seam** (mocking 경계): ...
- **Non-goal**: ...

## Behaviors (평면 또는 트리)

# 평면 예시 (단순 슬라이스)
- [x] behavior1   (RED→GREEN done)
- [x] behavior2
- [ ] behavior3   ← CURRENT
- [ ] behavior4

# 트리 예시 (복잡 슬라이스, 깊이 무제한, 깊이 5 초과 시 plan 재진입 권유)
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

## Cited decisions (vault·local)
- vault: `Decision - 비관적 락 정책` → 비관적 락 채택
- local: `features/<feature-name>/task-index.md` `## Decisions` 섹션 `[resolved]` 항목

## Cycle log
- 2026-05-09 14:32 — RED B2.guard.invalid → GREEN
- 2026-05-09 15:10 — RED B2.handler.409 → GREEN

Last cycle: <timestamp>
```

다른 슬라이스 파일은 **수정 금지**. 슬라이스 간 의존이 발견되면 사용자에게 보고 후 `/plan` 재호출 검토.

## 추가 태스크 발견 시 처리 — 분기 결정 룰

작업 중 새 태스크 발견 시 다음 표로 결정한다 (즉석 판단 금지).

| 신호 | 처리 경로 |
|------|-----------|
| 현재 슬라이스 demoable 안 + 같은 tracer bullet 경로 + 1-3일 안에 끝남 | **slice-tdd가 내부 분해** (트리에 자식 노드 추가) |
| 다른 슬라이스에 의존 / AFK·Demoable 4기준을 별도 만족해야 / 1-3일 narrow 깸 | task-index.md의 `## Decisions` 섹션에 `[pending][slice-<현재 슬라이스 번호>] slice 추가 후보: <설명>` 형태로 누적, **현 슬라이스 종료 후 `/plan` 재호출** |
| 가정 자체 흔들림 (요구사항·전제 무너짐) | **즉시 STOP + WIP 커밋 *제안* (사용자 승인 필요, Step 5.6 게이트 적용) + `/plan` 재진입** (task-index.md overwrite/append/abort 분기 진입) |

→ **현 슬라이스 진행 중 `/plan`을 호출하지 않는다** (가정 흔들림 케이스 제외). 슬라이스 종료 직전·직후에만 재호출.

## 트리 형식 태스크 분해 (옵션)

복잡한 슬라이스에서 한 behavior가 여러 sub-step을 요구할 때 들여쓰기로 트리를 구성할 수 있다. 단순 슬라이스는 평면 리스트로 충분.

### 트리 vs 평면

| 형식 | 사용처 |
|------|--------|
| **평면** | behavior 3-5개로 단순. 자식 분해 불필요. |
| **트리** | 한 behavior가 endpoint·validation·state·persistence 등 여러 단위로 자연스레 쪼개지는 경우. |

평면을 쓰다가 도중에 트리로 전환 가능 (해당 behavior 아래 자식 추가). 자동 변환은 하지 않는다.

> **트리 조작 규칙·예시·RED→GREEN 관계는 `tree-decomposition.md` 참조.** 트리 사용 시 6가지 조작 룰(leaf 추가 권한, y/n, 자동 GREEN, 깊이 5 초과 경고 등)이 거기 있다. 평면만 쓸 거면 이 문서를 읽지 않아도 된다.

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
- `tree-decomposition.md` — 트리 형식 태스크 분해 옵션 (조작 규칙 6개·예시·RED→GREEN 관계)
- `slicing.md` — Vertical slice + tracer bullet 원칙
- `behaviors.md` — Behavior 추출·식별 5원칙

## Done When (슬라이스 단위)

다음 모두 충족 시에만 슬라이스를 완료로 본다 (Step 5 verification 게이트 통과 = 이 체크리스트 통과).

- Step 0 Scope 4항목(in / out / seam / non-goal)이 채워짐
- Behaviors 트리의 모든 leaf가 GREEN
- 부모 노드 GREEN이 자식 모두 GREEN으로 자동 도출됨 (수동 체크 없음)
- Step 5의 5단계 게이트(빌드 / 단위 테스트 / 통합 테스트 / scope 일치 / 가정 흔들림 점검) 통과
- 사용자 y/n 후 `task-index.md`의 슬라이스 진행 마커 `[~]` → `[x]` 토글
- `tdd-state/slice-N.md`의 Cycle log·Cited decisions 갱신 완료
- 신규 trap·pending 결정이 task-index.md `## Decisions` 섹션에 `[trap][slice-N] / [pending][slice-N]` 표기로 누적됨 (해당 시 — 현재 슬라이스 번호를 반드시 함께 박는다)



이 표는 plan / slice-tdd / handoff / takeover 4개 자산이 모두 동일하게 따른다.

| 파일 | 생성 | 갱신 | 읽기만 |
|------|------|------|--------|
| `task-index.md` | plan / handoff (Step 2.5 신규 슬롯 생성 시) | plan (재진입 시 overwrite/append/abort/fill), **slice-tdd** (슬라이스 진행 마커 토글 y/n + Decisions 섹션 vault 인용 시), handoff (TODO 섹션 일괄 y/n) | takeover |
| `tdd-state/slice-N.md` | **slice-tdd** (슬라이스 시작 시) | **slice-tdd** (RED→GREEN 사이클마다) | handoff, takeover |

이 매트릭스를 벗어난 수정은 금지. 특히 takeover는 어느 파일도 수정하지 않는다.

**별도 파일 정책**: 모든 결정·트랩은 `task-index.md`의 `## Decisions` 섹션 안에서 관리한다. 별도의 `decisions.md` / `pending-decisions.md` 파일은 사용하지 않는다 (단일 source of truth 원칙). Decisions 섹션 항목은 `[<상태>][<출처>]` 두 태그를 머리에 박는다 — 상태는 `[resolved] / [pending] / [trap]`, 출처는 `[plan] / [slice-N]` (plan Step 4-3 템플릿 참조).

## Anti-Patterns

대부분의 안티패턴은 위 각 Step의 이유를 이해하면 자명하게 도출된다. 아래는 그 이유만으로는 *추론하기 어려운* — 이 스킬 특유의 경계에 관한 — 항목만 추린 것이다:

- ❌ 다른 슬라이스의 `tdd-state/slice-M.md` 수정 (현 슬라이스 파일만 — 슬라이스 독립성)
- ❌ task-index.md를 진행 마커 한 글자 외로 수정 (Slices 본문·TODO·Decisions는 plan/handoff 역할)
- ❌ `slices.md` / `TODO.md` 사용 (폐지된 파일명 — task-index.md로 통합)
- ❌ 슬라이스 진행 중 `/plan` 호출 (가정 흔들림 케이스만 예외)
- ❌ 새 태스크 발견 시 분기 룰 표를 보지 않고 즉석 판단 (slice 추가 vs 트리 분해 vs plan 재진입)
- ❌ `git add -A` / `git add .` / `--no-verify` / amend / force-push (Step 5.6 게이트의 구체 금지)
- ❌ 다른 플러그인의 `tdd` 트리거로 이 스킬이 호출되는 것 (이름이 `slice-tdd`로 분리된 이유)
