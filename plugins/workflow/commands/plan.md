---
description: 새 기능/이슈를 vertical slice로 분해하고 TDD 구현 준비. 모호함 해소 → 슬라이싱 → features/<feature-name>/ publish → tdd 안내까지 수행한다.
---

# /plan — Vertical Slice Planner

OMC만 의존. 외부 플러그인 의존 X. 사용자 입력 받아 다음 4단계 진행.

## Input
사용자가 이 커맨드 뒤에 제공한 자유 텍스트 (기능 설명, 이슈 링크, 요구사항 등)

## Feature Name 결정

publish 위치를 정하기 위해 feature-name (kebab-case slug)을 먼저 확정한다:

1. 사용자 입력에 명시적 이름이 있으면 (`feature: order-cancel`, `이름은 payment-msa`) **그대로 우선 사용**
2. 없으면 입력 내용에서 추론 (예: *"주문 취소 기능"* → `order-cancel`)
3. 추론 결과를 사용자에게 보여주고 한 번에 확인 받음 (`order-cancel 로 진행할까요? 다른 이름이면 말씀해 주세요`)

확정된 이름은 이후 모든 publish 경로에 사용된다.

## Step 1: Question Debt 분류 (vault 인용)

미명시된 결정 후보 나열 → 각각 soft/hard 분류:

- **soft**: ① 합리적 기본값(업계 관례·기존 결정) 존재 + ② 영향 해당 슬라이스 한정 (둘 다 만족)
- **hard**: 둘 중 하나라도 불충분

> 출처: vault `Decision - Question Debt soft hard 복합 기준`

## Step 2: 모호함 해소 (게이트)

```
hard 결정 0개  → 즉시 Step 3
hard 결정 1-3개 → 직접 grill (한 번에 1질문, 추천답 동봉, 코드베이스 우선 탐색)
hard 결정 4+개 → omc:deep-interview Skill 위임 (mathematical ambiguity gating)
```

vault decision 검색 — 같은 영역 기존 결정 있으면 인용 (사용자 재질문 회피).

## Step 3: Vertical Slice 분해

각 슬라이스 다음 4기준 모두 충족해야 함:

- [ ] **Vertical**: schema → API → UI → test 모든 레이어 통과
- [ ] **Demoable**: 머지 후 단독 시연·검증 가능
- [ ] **Narrow**: 1-3일 내 완료 가능
- [ ] **AFK 우선**: 사람 결정 없이 머지 가능 (불가능하면 HITL 표시)

🚫 **Horizontal slicing 안티패턴 금지** — "schema 슬라이스 → API 슬라이스 → UI 슬라이스" 같은 레이어별 분리 절대 X.

## Step 4: `features/<feature-name>/` publish

### 4-1. `features/` 디렉토리 존재 확인

```bash
test -d features && echo "exists" || echo "missing"
```

**`features/` 부재 시 사용자에게 허락 받기**:

> `features/` 디렉토리가 없습니다. `features/<feature-name>/slices.md`를 생성하기 위해 만들어도 될까요? (y/n)

- `n` 응답 시 → 작업 중단, 사용자가 다른 위치를 지정하면 그에 따름
- `y` 응답 시 → 다음 단계로

### 4-2. 기존 slices.md 발견 시 분기 (재진입 케이스)

```bash
test -f features/<feature-name>/slices.md && echo "exists" || echo "new"
```

기존 파일이 있으면 사용자에게 다음 3옵션을 번호로 제시하고 선택받는다:

1. **overwrite** — 기존 파일 백업 후 새로 작성. 이전 슬라이스 진행이 모두 폐기되어도 무방한 경우.
2. **append** — 기존 슬라이스 뒤에 신규 슬라이스를 이어 붙인다. 새 요구사항 추가 케이스.
3. **abort** — 작성 중단. 사용자가 직접 수정 후 다시 호출.

선택 없이 자동 overwrite 금지.

### 4-3. publish

```bash
mkdir -p features/<feature-name>
```

`features/<feature-name>/slices.md` 작성. 템플릿:

```markdown
---
feature_name: <feature-name>
generated: [날짜]
plan_input: [원래 요청 한 줄 요약]
---

# Slices for: [기능 이름]

## Open Questions (resolved)
- [질문1] → [결정] (vault: [참조] 또는 grill 결과)

## Slices (dependency order)
- [ ] 1. **[tracer bullet]** [한 줄 설명]
       behaviors: [behavior 리스트]
       AFK: yes/no
       depends on: -
- [ ] 2. ...
       depends on: 1
```

frontmatter의 `feature_name`은 takeover/handoff가 슬롯 매칭에 사용한다. **반드시 포함**.

### 4-4. TODO.md 골격 생성

`features/<feature-name>/TODO.md`에 슬라이스별 1항목으로 초기 골격 생성 (handoff 스킬이 이후 동기화):

```markdown
# Feature: [기능 이름]

## 진행 중 (WIP)
(없음)

## 다음 후보 (Next)
- [ ] Slice 1: [tracer bullet 설명]
  - 검증: 모든 behavior GREEN + verification gate 통과
- [ ] Slice 2: ...

## 완료 (Done)
(없음)

## Blocked / Waiting
(없음)

## Decisions / Traps (수명 긴 메모)
(plan/tdd 진행 중 누적)
```

`features/`는 git 추적 가능한 위치이므로 `.gitignore` 추가 X. 다만 프로젝트 컨벤션에 따라 사용자가 별도 처리 가능.

## Step 5: TDD 핸드오프

마지막에 다음 메시지 출력:

> ✅ Plan 완료. `features/<feature-name>/`에 publish됨:
> - `slices.md` — N개 슬라이스
> - `TODO.md` — 진행 추적용 골격
>
> 다음 명시 호출로 구현 시작:
> - `tdd로 슬라이스 #1 시작` (또는)
> - `RED→GREEN으로 슬라이스 #1 작업` (또는)
> - `features/<feature-name>/slices.md 픽업: #1`
>
> 위 키워드 중 하나가 포함되면 **tdd 스킬**이 자동 활성됩니다.
>
> 세션 종료 시 `/handoff` 명시 호출 → 다음 세션은 `/takeover` 명시 호출로 인수.

## Hard Dependencies (모두 OMC)

- `omc:deep-interview` (Step 2의 hard 4+ 케이스)
- `mcp__vault-decision__advise` (Step 1, 2의 vault 조회)

설치 안 되어 있으면: *"omc 플러그인 설치하세요: /oh-my-claudecode:setup"* 안내 후 중단.

## 상태 갱신 책임 매트릭스 (4개 자산 공통)

이 표는 plan / tdd / handoff / takeover 4개 자산이 모두 동일하게 따른다.

| 파일 | 생성 | 갱신 | 읽기만 |
|------|------|------|--------|
| `slices.md` | **plan** | **plan** (재진입 시 overwrite/append/abort 선택) | tdd, handoff, takeover |
| `tdd-state.md` | tdd (없으면 생성) | tdd (RED→GREEN 사이클마다) | handoff, takeover |
| `TODO.md` | **plan** | handoff (사용자 확인 후 일괄), tdd (슬라이스 완료 시 한 줄 제안 y/n) | takeover |
| `pending-decisions.md` | tdd (필요 시) | tdd | **plan**, handoff, takeover |
| `decisions.md` | 사용자/**plan** | **plan**, tdd | handoff, takeover |

이 매트릭스를 벗어난 수정은 금지. plan은 `tdd-state.md`를 만들지 않는다 (tdd가 첫 호출 시 생성).

## Anti-Patterns

- ❌ 사용자에게 hard 4+ 질문을 직접 grill (deep-interview 위임 안 함)
- ❌ 모호함 미해소 상태로 슬라이싱 진입
- ❌ horizontal slice 생성
- ❌ vault 조회 생략 (같은 결정 반복 질문)
- ❌ tdd 핸드오프 안내 누락
- ❌ `features/` 디렉토리 무단 생성 (사용자 허락 없이)
- ❌ feature-name을 사용자 확인 없이 결정
- ❌ `.scratch/` 폴백 사용 (이 워크플로우는 `features/` 단일 경로)
- ❌ 기존 `slices.md`를 사용자 선택 없이 overwrite
- ❌ slices.md에 `feature_name` frontmatter 누락
- ❌ `tdd-state.md` 생성 (그건 tdd의 역할)
