---
name: handoff
description: 사용자가 명시적으로 "/handoff" 슬래시 커맨드를 호출하거나 "/handoff 실행", "/handoff 작성" 같이 스킬 이름을 직접 지명할 때만 사용한다. 현재 세션의 작업 내용·결정·함정·미완료 작업을 다음 세션으로 넘길 handoff 문서로 작성하고, 연결된 features/<feature-name>/TODO.md를 갱신한다. 사용자가 단순히 "오늘 작업 정리해줘", "이거 다음에 이어서 하자" 등 의도만 표현하고 스킬을 지명하지 않았다면 절대 자동 호출하지 마라. 자동 제안·자동 트리거 금지.
disable-model-invocation: true
---

# handoff — 세션 종료 dump + features/ 동기화

## ⛔ 호출 규칙 (가장 중요)

이 스킬은 **사용자가 `/handoff`를 명시적으로 호출했을 때만** 동작한다.

- ❌ "오늘 작업 정리해줘" 같은 의도 표현만으로 자동 실행 금지
- ❌ context 사용률 70% 도달, `/clear` 감지 등으로 자동 제안 금지
- ❌ "handoff를 만들까요?" 식 선제 권유 금지
- ✅ 사용자가 명시적으로 `/handoff` 또는 "handoff 스킬 실행해" 등 지명한 경우만 실행

## 목적

세션이 끝날 때 두 가지를 동시에 한다:

1. **세션 dump**: 다음 세션이 hypothesis로 다룰 수 있는 형태로 작업 상태를 `.claude/handoff/`에 떨어뜨린다.
2. **features/ 동기화**: 연결된 `features/<feature-name>/TODO.md`에서 이번 세션이 완료한 항목을 체크하고, 새로 발견한 작업을 추가한다. 또한 `slices.md`, `tdd-state.md`도 Relevant Files에 자동 포함한다 (plan/tdd가 만든 자산).

handoff 문서는 **fact가 아닌 hypothesis** — 다음 세션은 이 문서를 그대로 믿지 않고 코드와 대조 검증한다 (`takeover` 스킬이 그 역할).

## 4개 자산 통합 모델

이 스킬은 plan/tdd/handoff/takeover 4개 자산이 공유하는 단일 디렉토리 컨벤션을 전제한다:

```
features/<feature-name>/
├── slices.md         ← /plan이 생성, vertical slice 분해
├── tdd-state.md      ← tdd 갱신, behavior 진행
├── TODO.md           ← handoff가 동기화 (이 스킬)
├── pending-decisions.md ← (선택) tdd 진행 중 누적
└── decisions.md      ← (선택) 수명 긴 결정·트랩
```

`/handoff` 호출 시 위 디렉토리의 모든 파일을 자동으로 Relevant Files 후보에 포함한다. 단, 권장 5-8개 한도 내에서 압축한다.

## 핵심 원칙

1. **명령형 금지** — "Implement X" ❌ → "X is not yet implemented" ✅
   다음 세션이 맹목적으로 실행하지 않도록.
2. **파일은 라인 번호까지** — `file.kt` ❌ → `file.kt:L45-L72` ✅
3. **CLAUDE.md 중복 금지** — Prompt for New Chat에 "Read CLAUDE.md first" 포함.
4. **Traps 섹션 비울 수 없음** — 실패 정보가 가장 가치 높음. 이번 세션에 실패가 없었으면 그 사실을 명시.
5. **Relevant Files는 5-8개 권장** — 검증된 매직 넘버는 아님. 다음 세션이 첫 응답 전에 모두 검증할 수 있는 양으로 압축한다는 게 본질. 작업 종류에 따라 조정 가능.
6. **분량은 다음 세션 검증 비용 기준** — 게시글 권장은 2K 토큰이지만, 검증된 숫자 아님. 핵심은 "다음 세션이 첫 응답 전에 다 읽고 검증 가능한 양".
7. **TODO.md 변경은 사용자 확인 후** — 자동 체크/추가 전에 변경 후보를 보여주고 승인받음.

## 작업 단위와 handoff 1회의 관계

**handoff 1회 = TODO.md 항목 1개 (또는 작은 묶음)** 가 이상적이다. 컨텍스트 사용률 임계값(예: 70%) 같은 매직 넘버는 박지 않는다 — 검증된 숫자가 없고, 작업 종류에 따라 다르기 때문.

대신 다음 신호 중 **하나라도 발생하면 작업 단위가 너무 컸다**는 뜻이고, 그 자리에서 handoff 후 분할을 권장한다:

- handoff Key Decisions이 3개를 초과
- Traps to Avoid가 5개를 초과
- Relevant Files가 8개를 초과
- 작업이 끝나기도 전에 컨텍스트가 답답해짐

이런 신호가 반복되면 TODO.md 항목 자체를 더 작게 쪼개는 게 본질적 해결이다.

> **TODO.md 항목 크기 가이드**: 좋은/나쁜 항목 예시, 작성 체크리스트, 권장 구조, 안티 패턴은 `references/todo-sizing.md` 참고. handoff 작성 중 "Step 2: 연결된 features/ 식별" 단계에서 TODO.md 구조나 항목 크기에 의문이 생기면 그 가이드를 먼저 읽는다.

## 입력 수집

다음 정보를 순서대로 수집한다:

```bash
# 1. 현재 git 상태 (git repo인 경우)
git rev-parse HEAD                    # head_commit (frontmatter용)
git merge-base HEAD main              # merge_base_with_main
git rev-parse --abbrev-ref HEAD       # branch
git status --short
git diff --stat
git log --oneline -10
```

git repo가 아니면 위 명령은 실패한다. 그 경우 frontmatter에서 git 필드 생략하고 `git_context: 없음`으로 기록.

```bash
# 2. 워크트리 경로
pwd
```

```bash
# 3. 동일 브랜치/날짜의 기존 handoff 존재 여부 확인
ls .claude/handoff/$(date +%Y-%m-%d)-*.md 2>/dev/null
```

기존 파일이 있으면 사용자에게 **overwrite vs append vs 새 파일** 선택을 묻는다.

## 출력 위치

`.claude/handoff/<YYYY-MM-DD>-<branch-slug-or-noname>.md`

- `branch-slug`: 슬래시(`/`)를 하이픈(`-`)으로 변환. 예: `fix/skills-subskill-chaining` → `fix-skills-subskill-chaining`
- git repo가 아니면 branch 부분 대신 작업 디렉토리 베이스명 사용
- 디렉토리 없으면 생성
- `.claude/handoff/`는 `.gitignore`되어야 함 (절대 경로·사용자 선호·secret 노출 방지). 디렉토리 생성 시 `.gitignore`에 추가되어 있는지 확인하고 없으면 추가:
  ```
  .claude/handoff/
  !.claude/handoff/.gitkeep
  ```

## 출력 문서 템플릿

```markdown
---
session_date: 2026-05-04
branch: fix/skills-subskill-chaining
head_commit: 403569cabcdef          # 다음 세션의 stale 판정 기준
merge_base_with_main: 974f78fghijk
worktree: /Users/jhj/IdeaProjects/example
feature_name: skills-subskill-chaining     # features/ 슬롯 (있으면)
relevant_files_count: 6
---

# Handoff — 2026-05-04 — fix/skills-subskill-chaining

## Summary
(1-3문장으로 이번 세션이 무엇을 했는지 상태 서술. 명령형 금지)

## Key Decisions
- **결정 1**: 한 줄 요약
  - **Why**: 근거
  - **Alternatives ruled out**: 폐기 옵션과 폐기 이유

## Traps to Avoid
- ❌ 시도→실패한 접근 + 왜 실패했는지
- ❌ 표면적으로 그럴듯하지만 함정인 패턴
(이번 세션에 실패가 없었으면 "이번 세션은 첫 시도가 모두 통과함"이라고 명시)

## Working Agreements
- 사용자 선호 (예: "PR 만들기 전에 무조건 코드리뷰 받기")
- 이번 세션에서 사용자가 명시한 제약

## Relevant Files (최대 5-8개)
- `path/to/file.kt:L45-L72` — 무엇을 위한 라인인지, 왜 중요한지
- `features/<feature-name>/slices.md` — plan 슬라이스 (해당 시)
- `features/<feature-name>/tdd-state.md` — tdd behavior 진행 (해당 시)

## Observed State
- 현재 코드/테스트가 어떤 상태인지 사실만 기록
- (예: "FooService.refresh가 race condition 의심됨. TestFooService.testRefreshConcurrent 실패 중")

## Blocked By
- 무엇이 풀려야 다음 작업이 가능한가
- (예: "백엔드의 user-id 마이그레이션 완료 대기 — 별도 PR #234")

## Candidate Next Action (참고용, 실행 명령 아님)
- "고려해볼 만한 다음 단계는 X일 수 있다"
- (반드시 단정형 아닌 가능성 표현. 다음 세션이 검증 후 결정)

## TODO Impact
- 적용된 변경: features/<feature-name>/TODO.md
  - 체크: N개 (...)
  - 추가: M개 (...)
- (TODO.md 없으면 "(연결된 TODO.md 없음 — features/ 슬롯 부재)")

## Verification Checklist (takeover 스킬이 따를 절차)
- [ ] 이 문서를 먼저 Read
- [ ] head_commit이 여전히 git에 존재하는지 확인
- [ ] Relevant Files를 모두 Read (라인 범위 유효성 확인)
- [ ] features/<feature-name>/ 의 slices.md, tdd-state.md, TODO.md를 hypothesis로 검증
- [ ] `git log <head_commit>..HEAD` 로 그 사이 변경 확인
- [ ] 검증 결과 한 단락 보고 후 사용자 지시 대기

## Prompt for New Chat
\`\`\`
다음 단계로 .claude/handoff/2026-05-04-fix-skills-subskill-chaining.md 를 먼저 Read 도구로 읽어라.
그 다음 CLAUDE.md를 읽고, 이미 거기서 다룬 내용은 재진술하지 마라.
"Relevant Files"의 파일들을 실제 Read 도구로 읽고, 이 문서의 주장(라인 번호 포함)을 코드와 대조해 검증하라.
features/<feature-name>/ 디렉토리가 있다면 slices.md, tdd-state.md, TODO.md도 hypothesis로 검증하라.
"Verification Checklist"의 모든 항목을 수행한 뒤, 검증 결과를 한 단락으로 보고하고 내 지시를 기다려라.
\`\`\`
```

## 실행 흐름

1. **git 상태 수집** (위 명령들; git repo 아니면 생략)
2. **연결된 features/<feature-name>/ 식별**
   - 현재 브랜치명·작업 디렉토리·세션 트랜스크립트에서 어떤 feature 작업인지 추론
   - `features/*/TODO.md` 존재 여부 확인 (`ls features/*/TODO.md 2>/dev/null` 후 가장 관련 높은 것 선택)
   - 여러 후보면 사용자에게 번호로 제시, 선택받음
   - 없으면 features/ 동기화 단계 건너뜀 (handoff 문서만 작성)
3. **트랜스크립트에서 추출**
   - 사용자가 명시한 결정/제약 → Key Decisions, Working Agreements
   - 시도→실패 접근 (대화에서 "그건 안 돼", "그 방식 말고 다른 방법", 사용자 거부 표현) → Traps to Avoid
   - 마지막 작업 지점 → Observed State, Blocked By
   - 이번 세션에서 명시적으로 완료된 작업 → TODO 체크 후보
   - 이번 세션에서 새로 발견된 작업·후속 과제 → TODO 추가 후보
4. **Relevant Files 선정**
   - 이번 세션에 Edit/Write/Read한 파일 중 다음 세션이 반드시 봐야 할 5-8개로 압축
   - 라인 번호까지 명시. 광범위 Read한 파일은 핵심 함수의 라인 범위만
   - features/<feature-name>/ 의 slices.md, tdd-state.md가 있으면 우선 포함
5. **명령형 검사** (자체 lint)
   - Open Work 섹션의 모든 문장이 "Implement", "Add", "Fix", "Do" 등 명령형 동사로 시작하는지 검사
   - 명령형이면 상태 서술형으로 재작성
6. **`.claude/handoff/<YYYY-MM-DD>-<branch-slug>.md` 작성**
7. **TODO.md 변경 후보 사용자 확인 + 적용** (Step 2에서 features/ 슬롯을 찾은 경우만)
   - 다음 형식으로 사용자에게 변경 후보 제시:
     ```
     [TODO.md 변경 제안: features/payment-msa/TODO.md]

     체크할 항목:
       [x] PaymentService 인터페이스 추출
       [x] OAuth refresh를 TX 밖으로 이동

     추가할 항목 (현재 진행 중 섹션에):
       [ ] race condition 재현 테스트 추가 (TestPaymentRefresh.testConcurrent)

     적용하시겠습니까? (y/n/edit)
     ```
   - `y` → 적용
   - `n` → 건너뜀 (handoff 문서에는 "TODO Impact (미적용)" 섹션으로만 기록)
   - `edit` → 사용자가 수정한 변경분으로 적용
   - **사용자 확인 없이 자동 수정 금지** (TODO.md는 source of truth)
8. **사용자에게 종합 보고**: handoff 경로 + TODO 변경 요약 + 한 줄 요약
9. **(옵션)** "/clear 하시겠습니까?" 묻기

## 예시: Open Work 변환

❌ 명령형:
```
- Implement retry logic in TokenService
- Fix the race condition in FooService
- Add tests for the new endpoint
```

✅ 상태 서술형 (3섹션 분리):
```
## Observed State
- TokenService.refresh는 retry 없이 단발 호출. 401 응답 시 즉시 throw.
- FooService.barCase 테스트가 race condition으로 간헐 실패. 재현율 30%.
- POST /api/widgets 엔드포인트 구현됨. 테스트 미작성.

## Blocked By
- (없음 — 다음 단계는 모두 같은 세션에서 가능)

## Candidate Next Action
- TokenService에 backoff 기반 retry 추가가 가장 영향 큼
- FooService race condition은 lock 도입 vs CAS 방식 결정 필요
- 엔드포인트 테스트는 fixture 재사용 가능성이 높음
```

## 상태 갱신 책임 매트릭스 (4개 자산 공통)

이 표는 plan / tdd / handoff / takeover 4개 자산이 모두 동일하게 따른다.

| 파일 | 생성 | 갱신 | 읽기만 |
|------|------|------|--------|
| `slices.md` | plan | plan (재진입 시 overwrite/append/abort 선택) | tdd, **handoff**, takeover |
| `tdd-state.md` | tdd (없으면 생성) | tdd (RED→GREEN 사이클마다) | **handoff**, takeover |
| `TODO.md` | plan | **handoff (사용자 확인 후 일괄)**, tdd (슬라이스 완료 시 한 줄 제안 y/n) | takeover |
| `pending-decisions.md` | tdd (필요 시) | tdd | plan, **handoff**, takeover |
| `decisions.md` | 사용자/plan | plan, tdd | **handoff**, takeover |

handoff는 `TODO.md`만 수정한다. `slices.md` / `tdd-state.md`는 Relevant Files에 포함만 하고 본문은 읽기 전용.

## features/ 통합 추가 규칙

`features/<feature-name>/TODO.md`를 다룰 때:

- **체크박스 추론 보수적으로**: 코드/테스트로 명시 검증된 항목만 `[x]` 체크. "구현한 것 같다" 수준은 건너뛰고 사용자에게 보고만.
- **항목 삭제 금지**: 폐기된 항목은 `~~취소선~~`으로 표시하고 이유 주석 추가, 실제 삭제는 사용자가 직접.
- **상위 섹션 구조 보존**: TODO.md의 기존 헤더·구조·우선순위 표기를 그대로 둠. 신규 항목은 적절한 섹션에 배치.
- **slices.md / tdd-state.md는 읽기만**: handoff는 TODO.md만 수정한다. slice 분해 변경은 `/plan` 재호출, behavior 진행은 tdd 스킬의 자동 갱신을 통해서만 일어난다.
- **TODO.md가 git에 커밋된 파일이면 변경 후 staging 상태**로 두고 사용자에게 알림 (자동 commit 금지)

## Done When

- `.claude/handoff/<YYYY-MM-DD>-<branch-slug>.md` 가 작성됨
- frontmatter에 `head_commit`, `merge_base_with_main` 포함됨 (git repo인 경우)
- Relevant Files 개수가 8개 이하
- Open Work이 Observed State / Blocked By / Candidate Next Action 3섹션으로 분리됨
- 명령형 동사로 시작하는 문장이 Open Work에 없음
- `.gitignore`에 `.claude/handoff/` 포함됨
- 연결된 features/ 슬롯이 있었다면 사용자 확인 후 TODO.md가 갱신되었거나, 미적용 사실이 handoff 문서에 기록됨
- handoff 문서에 `## TODO Impact` 섹션 존재 (TODO.md 없으면 "(연결된 TODO.md 없음)" 명시)
