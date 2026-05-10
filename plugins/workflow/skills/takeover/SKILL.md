---
name: takeover
description: 사용자가 명시적으로 "/takeover" 슬래시 커맨드를 호출하거나 "/takeover 실행", "takeover 스킬 써" 같이 스킬 이름을 직접 지명할 때만 사용한다. 이전 세션의 handoff 문서와 연결된 features/<feature-name>/ 디렉토리(task-index.md, tdd-state/slice-N.md)를 읽고, hypothesis로 다루며 실제 코드·git 상태와 대조해 stale 여부를 판정한 뒤 검증 결과를 보고한다. 사용자가 "어제 이어서", "어디까지 했지" 등 의도만 표현하고 스킬을 지명하지 않았다면 절대 자동 호출하지 마라. 자동 제안 금지.
disable-model-invocation: true
---

# takeover — 새 세션 시작 load + verify + features/ 컨텍스트화

## ⛔ 호출 규칙 (가장 중요)

이 스킬은 **사용자가 `/takeover`를 명시적으로 호출했을 때만** 동작한다.

- ❌ 새 세션 첫 턴에 `.claude/handoff/` 발견했다고 자동 제안 금지
- ❌ "어제 이어서" 같은 의도만으로 자동 실행 금지
- ❌ "takeover를 실행할까요?" 식 선제 권유 금지
- ✅ 사용자가 명시적으로 `/takeover` 또는 "takeover 스킬 실행해" 등 지명한 경우만 실행

> Anthropic 기본 `/resume`(세션 재시작)과 충돌을 피하기 위해 이 스킬은 `takeover`로 명명되었다. handoff(넘기기)의 짝으로 takeover(인수받기)를 의미한다.

## 목적

이전 세션이 작성한 handoff 문서와 연결된 `features/<feature-name>/` 디렉토리(task-index.md, tdd-state/slice-N.md)를 hypothesis로 받아들여, **실제 git/코드 상태와 대조**한 뒤 검증 결과를 보고한다. **자동 재개 금지** — 사용자 지시 없이 코드 작성하지 않는다.

## 4개 자산 통합 검증

이 스킬은 plan/tdd/handoff/takeover 4개 자산이 공유하는 단일 디렉토리 컨벤션을 전제한다:

```
features/<feature-name>/
├── task-index.md     ← /plan 산출물 (slice 정의 + 진행 마커 + TODO 섹션 + Decisions 섹션)
└── tdd-state/
    ├── slice-1.md    ← tdd 슬라이스마다 진행 상태 (behavior 트리)
    └── slice-N.md
```

모든 결정·트랩은 `task-index.md`의 `## Decisions` 섹션 안에서 관리한다. 별도의 `decisions.md` / `pending-decisions.md` 파일은 사용하지 않는다.

`/takeover` 호출 시 위 디렉토리의 모든 파일을 hypothesis로 읽어 stale 여부를 판정한다.

## 핵심 원칙

> 명령형은 새 세션이 맹목적으로 실행하게 만든다. Handoff는 fact가 아니라 hypothesis로 다뤄야 한다.

이 스킬의 모든 단계는 위 원칙을 구현한다.

## 안티 패턴 차단

- ❌ handoff 문서를 fact로 신뢰
- ❌ Candidate Next Action 자동 실행
- ❌ Relevant Files만 보고 실제 Read 건너뛰기
- ❌ 검증 결과 보고 없이 코딩 시작
- ❌ stale 판정을 날짜만으로 결정
- ❌ task-index.md / tdd-state/slice-N.md를 source of truth로 신뢰 (코드와 대조 후에만 판단)
- ❌ task-index.md / tdd-state/ 자동 수정 (takeover는 읽기·검증·보고만; 수정은 handoff/plan/tdd 각자의 역할)

## 실행 흐름

### Step 1: handoff 문서 선택

handoff는 브랜치보다 feature 단위 인계가 더 자연스럽다 (브랜치는 자주 바뀌고 rebase되지만 feature는 오래 간다).
검색 우선순위는 **feature_name 먼저, 브랜치는 fallback**.

```bash
# 0. 현재 브랜치 확인 (git repo인 경우)
git rev-parse --abbrev-ref HEAD 2>/dev/null

# 1. 현재 작업 디렉토리에서 feature_name 추론
#    - 먼저 features/*/task-index.md 검색 후 가장 관련 있는 feature_name 선택
#    - 후보 여러 개면 사용자에게 번호로 제시
current_feature=$(ls features/*/task-index.md 2>/dev/null | head -1 | xargs -I {} grep -m1 "^feature_name:" {} | cut -d: -f2 | xargs)

# 2. 1차 검색 — feature_name으로 frontmatter grep (cross-branch)
if [ -n "$current_feature" ]; then
  grep -l "^feature_name: ${current_feature}$" .claude/handoff/*.md 2>/dev/null | xargs ls -t 2>/dev/null
fi

# 3. 2차 fallback — 브랜치 슬러그 매칭
ls -t .claude/handoff/*-<current-branch-slug>.md 2>/dev/null | head -5

# 4. 3차 fallback — 모든 handoff에서 최근 N개
ls -t .claude/handoff/*.md 2>/dev/null | head -5
```

- 정확히 1개 매칭: 자동 선택 + 사용자에게 알림
- 여러 개: **feature 그룹핑 형태로 사용자에게 제시**, 선택 받음
- 없음: "사용 가능한 handoff 없음" 보고하고 종료

**다중 후보 제시 형식 (feature 그룹핑)**:

```
[feature: auth-bug-fix]
  1. 2026-05-04-fix-auth-bug.md (최신)
  2. 2026-05-03-fix-auth-bug.md
  3. 2026-04-28-feature-auth-init.md (다른 브랜치, 같은 feature)

[feature: payment]
  4. 2026-05-04-feature-payment.md

[feature 미지정 (legacy/ad-hoc, feature_name: (skipped) 또는 누락)]
  5. 2026-04-15-fix-typo.md

선택 (번호):
```

같은 feature_name을 가진 handoff끼리 묶고, 그룹 안에서는 시간 역순(최신 우선) 정렬.
feature_name이 `(skipped)` 또는 누락된 handoff는 "feature 미지정" 그룹으로 별도 표시.

### Step 2: 문서 읽기 + 무결성 체크

선택된 문서를 Read한다. frontmatter에서 다음을 추출:
- `head_commit`
- `merge_base_with_main`
- `branch`
- `session_date`
- `feature_name` (있으면)
- `relevant_files_count`

### Step 3: git 기반 stale 판정 (핵심)

날짜가 아닌 git 상태로 판정한다 (git repo인 경우). 강한 신호 → 약한 신호 순:

```bash
# 1. head_commit이 여전히 존재하는가? (force-push, rebase 감지)
git cat-file -e <head_commit> 2>&1
# 실패 → 강한 경고: "이 handoff가 작성된 commit이 더 이상 존재하지 않음. rebase/force-push 의심"

# 2. 그 사이 변경된 파일 수
git log <head_commit>..HEAD --name-only --pretty=format: 2>/dev/null | sort -u | grep -c .

# 3. Relevant Files 중 변경된 것
for file in <relevant-files>; do
  git log <head_commit>..HEAD -- "$file" --oneline 2>/dev/null
done

# 4. 현재 브랜치 vs handoff.branch
git rev-parse --abbrev-ref HEAD

# 5. dirty worktree
git status --short
```

판정 매트릭스:

| 신호 | 강도 | 행동 |
|------|------|------|
| head_commit 미존재 | 🔴 강함 | "rebase/force-push 발생. 라인 번호 전부 재검증 필요" |
| Relevant Files 중 N개 변경 | 🟠 중간 | "이 파일들 다시 검증 필요: ..." |
| 현재 브랜치 ≠ handoff.branch | 🟡 약함 | "다른 브랜치임. 계속할지 사용자 확인" |
| dirty worktree | 🟡 약함 | "미커밋 변경 있음: ..." |
| 7일 초과 (날짜) | ⚪ 정보 | 약한 정보성 메시지만 |

### Step 3.5: 연결된 features/<feature-name>/ 로드 + 검증

handoff 문서의 frontmatter `feature_name` 또는 본문 `## TODO Impact` 섹션에서 참조하는 features/ 슬롯 경로를 추출:

```bash
# frontmatter에 feature_name 명시되어 있으면 우선
# 없으면 본문에서 features/ 경로 추출
grep -oE "features/[^/]+/(task-index\.md|tdd-state/slice-[0-9]+\.md)" <handoff-path> | head -5

# 없으면 현재 브랜치 기반 추론
ls features/*/task-index.md 2>/dev/null
```

찾은 features/<feature-name>/ 디렉토리의 모든 파일에 대해:

1. **task-index.md Read** — 전체 컨텍스트 로드 (인덱스 + TODO + Decisions)
   - frontmatter `plan_status` 또는 `created_by` 확인:
     - `plan_status: not_run` 또는 `created_by: handoff` 발견 시 → **handoff-initiated 슬롯**임을 인식. Slices 섹션이 비어있는 게 정상이며, stale 신호로 처리하지 않는다. 보고에 *"이 task-index.md는 handoff가 만든 간소형. /plan을 호출하면 4번째 옵션 'fill'로 Slices 섹션 채울 수 있음"* 힌트 표시.
     - 위 필드 없으면 정상 plan 산출물로 간주
   - Slices 섹션 진행 마커 분포: `[ ]/[~]/[x]/[!]` 카운트로 수평 진행도 즉시 파악 (handoff-initiated 슬롯이면 모두 0개일 수 있음 — 정상)
   - `[~]` 표시된 슬라이스가 CURRENT (1개여야 정상, 2개 이상이면 stale 의심. handoff-initiated 슬롯이면 0개도 정상)
   - TODO 섹션의 `[x]` 중 의심스러운 것 (handoff에 언급 없음, 코드에 흔적 없음) 식별
   - Decisions / Traps 섹션 훑어 trap 인용 가능 여부 확인
2. **tdd-state/slice-N.md Read** (CURRENT 슬라이스만 우선) — behavior 진행도 체크
   - 현재 슬라이스의 어느 behavior가 GREEN/RED 상태인지 확인
   - 트리 형식이면 leaf 단위 진행도 + 깊이 추출 (깊이 5 초과 슬라이스는 *"plan 재진입 후보"* 로 보고에 포함)
   - 부모 노드의 GREEN 상태가 자식 모두 GREEN과 일치하는지 sanity check (불일치 시 stale 의심 신호)
   - 다른 슬라이스 파일(`slice-(N-1).md`, `slice-(N+1).md`)은 필요 시에만 Read

이 정보는 Step 5 보고에 포함한다. **3개 파일 모두 자체를 수정하지 않는다** — 수정은 handoff/plan/tdd 스킬의 역할.

### Step 4: Relevant Files 검증

```
for file in Relevant Files (최대 8개):
  Read(file, offset=L_start, limit=L_end - L_start)
  - 파일이 존재하지 않음 → "파일 삭제/이동됨"
  - 라인 번호 범위가 파일 길이 초과 → "라인 drift 발생"
  - 정상 → 핵심 패턴이 여전히 그 라인에 있는지 간단 확인
```

### Step 5: 검증 결과 보고 (구조화된 형태)

```markdown
## Takeover 검증 결과

**Handoff 문서 (선택됨)**: `.claude/handoff/2026-05-04-fix-skills-subskill-chaining.md`
**연결 features/**: `features/handoff-skill/`
**작성 시점**: 2026-05-04 → 현재 1일 경과

### Feature Timeline (handoff-skill)
*frontmatter에 `feature_name`이 있으면 항상 표시. 같은 feature의 모든 handoff를 시간순으로 묶어 보여줘 사용자가 작업 흐름을 즉시 인식할 수 있게 한다.*

| 날짜 | 브랜치 | 파일 | 상태 |
|---|---|---|---|
| 2026-04-28 | feature/handoff-init | 2026-04-28-feature-handoff-init.md | 과거 (검증 안 함) |
| 2026-05-01 | feature/handoff-init | 2026-05-01-feature-handoff-init.md | 과거 (검증 안 함) |
| 2026-05-04 | fix/skills-subskill-chaining | 2026-05-04-fix-skills-subskill-chaining.md | ⬅ CURRENT (Step 3·4 검증 대상) |

- 표는 같은 `feature_name` 가진 handoff 모두를 cross-branch로 묶음
- 과거 handoff는 *읽지 않음* (참조만). 검증은 CURRENT만.
- `feature_name`이 `(skipped)` 또는 누락된 handoff는 이 표에 포함하지 않음 (feature 미지정 단발 dump로 처리)

### Git stale 판정
- ✅ head_commit (403569c) 여전히 존재
- ⚠️ 그 이후 3개 commit 추가됨 (`git log 403569c..HEAD`)
- ✅ 현재 브랜치 일치: fix/skills-subskill-chaining
- ⚠️ dirty worktree: M features/handoff-skill/task-index.md

### Relevant Files 검증
- ✅ `path/to/file.kt:L1-L50` — 유효
- 🔴 `path/to/other.kt:L20-L40` — 라인 drift (현재 파일은 80라인까지만)
- ✅ 그 외 4개 파일 유효

### features/ 자산 상태
- **task-index.md**:
  - Slices: 5개 중 `[x]` 2개 (#1, #2), `[~]` 1개 (#3 CURRENT), `[ ]` 2개 (#4, #5)
  - TODO 섹션: `[x]` 항목 중 의심스러운 것 0개 / 신규 발견 후보(handoff Candidate Next Action 기반) `race condition 재현 테스트` 미반영
  - Decisions: 트랩 2개 인용됨, 본 세션 작업과 무관
- **tdd-state/slice-3.md**: behavior 4개 중 2개 GREEN, 1개 CURRENT, 1개 미착수. 트리 깊이 2 (정상 범위).

### 문서가 모르는 새 변경
- 새 파일: `features/handoff-skill/tdd-state/slice-4.md` (1일 전 추가됨)

### 종합
- 전반적으로 유효. 단, `path/to/other.kt`의 라인 번호는 stale.
- "Candidate Next Action"의 첫 항목(Open Work 3섹션 분리)은 코드에 이미 적용됨에도 task-index.md TODO 섹션에는 미체크. 다음 /handoff 호출 시 동기화 후보.
- tdd-state/slice-3.md의 CURRENT behavior가 다음 작업 단위로 명확.

### 깊이 5 초과 슬라이스 (plan 재진입 후보)
- 0개 (모두 정상 범위)
또는:
- 2개:
  - Slice #3 — 깊이 6 (3 levels too deep) → `/plan` 재호출로 분리 권장
  - Slice #5 — 깊이 7 (4 levels too deep) → `/plan` 재호출로 분리 권장

### 다음 가능한 명시 호출 예시
- `tdd로 슬라이스 #3 이어서` (또는 `RED→GREEN으로 슬라이스 #3 작업`)
- `/plan` 재호출 (가정이 흔들렸거나 신규 슬라이스 분해 필요, 또는 깊이 5 초과 슬라이스 분리)
- `/handoff` (지금까지 보고만 받고 종료)

> 위 예시는 **참고용**이다. 사용자가 명시 지시 없이 takeover만 호출했다면 그대로 대기한다. 자동 진행 금지.

**다음 작업 지시를 기다립니다.**
```

### Step 6: 사용자 지시 대기

검증 결과만 보고하고 대기한다. **자동 진행 금지**. 사용자가 명시 지시("그럼 X부터 진행해")를 줄 때까지 코드 작성/수정/실행하지 않는다.

## Edge Case 처리

| 상황 | 행동 |
|------|------|
| `.claude/handoff/` 디렉토리 자체 없음 + features/ 슬롯도 없음 | "handoff·features/ 슬롯 모두 없음. 새 기능이면 `/plan`을 호출하세요. takeover로 할 일 없음." |
| `.claude/handoff/` 없음 + `features/<name>/` 슬롯은 있음 | 슬롯 자체를 hypothesis로 검증 (Step 3.5만 수행). 보고에 *"handoff 누락 — 직전 세션이 handoff 없이 종료된 것으로 보임. features/ 슬롯이 stale일 가능성 높음"* 명시. 다음 명시 호출 예시는 `/plan` 재호출 또는 `tdd로 슬라이스 #N 이어서` |
| handoff 파일 frontmatter 손상 | 손상 사실 보고하고 본문만 읽어 hypothesis로 사용 |
| `head_commit` 필드 누락 (구버전 handoff or non-git) | git 기반 검증 건너뛰고 날짜 기반 약한 검증으로 fallback |
| Relevant Files가 모두 삭제됨 | "이 handoff는 stale 가능성 매우 높음. 새 세션으로 시작 권장" |
| detached HEAD 상태 | 경고: "detached HEAD. 브랜치 비교 의미 없음" |
| features/<feature-name>/ 디렉토리 자체 없음 | features/ 자산 상태 섹션 생략, "(연결된 features/ 슬롯 없음)" 명시 |
| features/ 안의 일부 파일만 있음 (예: task-index.md만, tdd-state/ 부재) | 있는 것만 검증, 없는 건 생략. tdd-state/ 부재면 "tdd 미시작" 으로 추정 |
| `[~]` 마커가 2개 이상 발견 (정상은 1개) | "복수 CURRENT 발견. 이전 세션이 슬라이스 전환 마커 토글을 누락한 것으로 보임" 경고 후 사용자에게 어느 게 CURRENT인지 확인 |
| task-index.md frontmatter에 `created_by: handoff` 또는 `plan_status: not_run` | handoff-initiated 슬롯. Slices 빈 것은 정상. 보고에 *"/plan으로 4번째 옵션 'fill'을 선택하면 Slices/Decisions를 채워 정상 plan으로 승격 가능"* 힌트 표시. stale 신호로 처리하지 않음 |
| feature_name이 `(skipped)` 또는 누락 | Feature Timeline 섹션 생략, "(feature 미지정 — 단발 dump 또는 legacy handoff)" 명시. 다른 handoff와 묶지 않음 |

## 상태 갱신 책임 매트릭스 (4개 자산 공통)

이 표는 plan / tdd / handoff / takeover 4개 자산이 모두 동일하게 따른다.

| 파일 | 생성 | 갱신 | 읽기만 |
|------|------|------|--------|
| `task-index.md` | plan / handoff (Step 2.5 신규 슬롯 생성 시) | plan (재진입 시 overwrite/append/abort/fill), tdd (슬라이스 진행 마커 토글 y/n + Decisions 섹션 vault 인용 시), handoff (TODO 섹션 일괄 y/n) | **takeover** |
| `tdd-state/slice-N.md` | tdd (슬라이스 시작 시) | tdd (RED→GREEN 사이클마다) | handoff, **takeover** |

**takeover는 어느 파일도 수정하지 않는다.** 검증·보고만 한다.

**별도 파일 정책**: 모든 결정·트랩은 `task-index.md`의 `## Decisions` 섹션 안에서 관리한다. 별도의 `decisions.md` / `pending-decisions.md` 파일은 사용하지 않는다 (단일 source of truth 원칙). Decisions 섹션 항목은 `[<상태>][<출처>]` 두 태그를 머리에 박는다 — 상태는 `[resolved] / [pending] / [trap]`, 출처는 `[plan] / [slice-N]` (plan Step 4-3 템플릿 참조).

## Done When

- handoff 문서가 선택되고 Read됨 (또는 폴백 경로로 features/ 슬롯 검증)
- frontmatter의 `head_commit` 기준으로 git stale 판정 수행됨 (git repo인 경우)
- Relevant Files가 모두 Read되고 라인 번호 유효성 검증됨
- features/<feature-name>/ 슬롯이 있으면 task-index.md와 CURRENT 슬라이스의 tdd-state/slice-N.md를 hypothesis로 검증됨
- 구조화된 검증 결과 + **`### 깊이 5 초과 슬라이스` 카운트 섹션** + **`### 다음 가능한 명시 호출 예시` 헤더가 반드시 존재**하는 형태로 사용자에게 보고됨
- 두 섹션 모두 빠지면 보고 미완 — 추가 후 종료
- **자동 진행 없이** 사용자 지시를 대기하는 상태로 종료
