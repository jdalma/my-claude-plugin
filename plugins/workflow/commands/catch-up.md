---
name: catch-up
description: "새 세션 시작 시 최근 작업 상태 복원"
disable-model-invocation: true
---

# /catch-up - 세션 시작 시 작업 연속성 복원

## Usage

```
/workflow:catch-up              # 기본: 최근 5개 세션
/workflow:catch-up --sessions 3 # 세션 수 지정
```

## Input

$ARGUMENTS

---

### Step 1: 세션 파일 목록 수집

**1-1. 인자 파싱**

`$ARGUMENTS`에서 `--sessions N` 값을 파싱한다. 없으면 기본값 5.
N은 1 이상의 정수여야 한다. 숫자가 아니거나 1 미만이면 안내하고 중단한다:
```
유효하지 않은 세션 수입니다: {값}. 1 이상의 숫자를 입력해주세요.
```

**1-2. 프로젝트 디렉토리 특정 및 세션 파일 목록 수집**

Bash 도구로 아래를 실행한다:

```bash
SESSIONS=${SESSIONS:-5}
PROJECT_DIR_NAME=$(echo "$PWD" | sed 's|^/||' | tr '/' '-')
TRANSCRIPT_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/-${PROJECT_DIR_NAME}"

if [ ! -d "$TRANSCRIPT_DIR" ] || [ -z "$(ls "$TRANSCRIPT_DIR"/*.jsonl 2>/dev/null)" ]; then
  echo "분석할 세션이 없습니다."
  echo "경로: $TRANSCRIPT_DIR"
  echo "이 프로젝트에서 아직 Claude Code 세션을 시작한 적이 없거나 경로가 다릅니다."
  exit 1
fi

# 현재 세션(가장 최근 파일)은 제외하고 최근 N개 선택
FILES=$(ls -t "$TRANSCRIPT_DIR"/*.jsonl | tail -n +2 | head -n $SESSIONS)

if [ -z "$FILES" ]; then
  echo "현재 세션 외에 분석할 이전 세션이 없습니다."
  exit 1
fi

echo "$FILES"
```

위 스크립트가 `exit 1`로 종료되면 사용자에게 에러 메시지를 보여주고 중단한다.

### Step 2: 세션별 다이제스트 + Git 상태 수집

> **REQUIRED SUB-SKILL**: `workflow:session-digest`

Step 1에서 얻은 세션 파일 목록의 **각 파일에 대해** `workflow:session-digest` 스킬을 호출한다.
이 스킬은 `context: fork`로 서브에이전트에서 격리 실행되어, 세션 트랜스크립트 원문이 메인 컨텍스트를 오염시키지 않고 구조화된 요약 JSON만 리턴한다.

**세션별 호출:**
```
각 세션 파일에 대해:
Skill tool 호출:
- skill: "workflow:session-digest"
- args: |
    session_file: {세션 파일 절대 경로}
```

세션 다이제스트 수집이 완료되면, Git 상태를 수집한다 (Bash 도구):

```bash
echo "=== GIT LOG ==="
git log --oneline -20

echo ""
echo "=== GIT BRANCHES ==="
git branch --sort=-committerdate -a

echo ""
echo "=== GIT STATUS ==="
git status

echo ""
echo "=== GIT DIFF MAIN STAT ==="
git diff main --stat
```

### Step 2.5: 프로젝트 계획 문서 탐지 및 진척도 집계

세션 트랜스크립트만으로는 **"프로젝트 전체 어디까지 왔나"**를 알 수 없다. 이 단계에서는 레포 내 로드맵 문서를 탐지하고 체크박스 진척도를 집계한다.

**탐지 대상 (반드시 Claude의 `Glob` 도구 사용 — 셸 `**` glob은 zsh에서 `NOMATCH`로 실패할 수 있음):**
- `docs/**/TODO*.md`, `docs/**/ROADMAP*.md`, `docs/**/PLAN*.md`
- `.omc/plans/*.md`
- 레포 루트의 `TODO.md`, `ROADMAP.md`

**탐지 결과 처리:**

1. 발견된 문서가 0개면 "프로젝트 계획 문서 없음"으로 기록하고 Step 3으로 진행
2. 발견된 문서가 1개 이상이면 **최근 수정 시각 기준 Top 3**만 선택
3. 각 문서에 대해 Read 도구로 전문을 읽고 다음을 추출:

```
- 문서 경로
- 마지막 수정 날짜 (git log -1 --format=%ai -- {path} 또는 Read의 최신 상태 기준)
- 체크박스 통계: `- [x]` 수 vs `- [ ]` 수 (grep -c 활용)
- 섹션별 진척도: H2/H3 헤더 직하 섹션에서 `- [ ]` 개수가 많은 상위 3개 섹션 추출
- "현재 상태 요약", "남은 작업", "Next Steps" 류 섹션이 있으면 그 첫 10줄 추출
```

**집계용 bash 스니펫 예시:**

```bash
DOC_PATH="$1"
DONE=$(grep -c '^\s*-\s*\[x\]' "$DOC_PATH" 2>/dev/null || echo 0)
TODO=$(grep -c '^\s*-\s*\[ \]' "$DOC_PATH" 2>/dev/null || echo 0)
TOTAL=$((DONE + TODO))
if [ "$TOTAL" -gt 0 ]; then
  PCT=$((DONE * 100 / TOTAL))
  echo "$DOC_PATH: $DONE/$TOTAL ($PCT%)"
fi
```

### Step 3: 미완료 작업 추정 및 권장 다음 스텝

다음 신호들을 조합하여 미완료 작업을 추정한다:

- **프로젝트 계획 문서 (Step 2.5)**: 계획 문서의 `- [ ]` 항목 중 다음 조건을 만족하는 것 우선
  - "즉시 착수 가능" / "Phase 1" / "Next" 류 섹션에 속함
  - 선행 의존성(다른 미완료 항목)이 없거나 적음
- **Uncommitted changes**: `git status`에 unstaged/untracked 파일이 있으면 해당 작업이 미완료
- **마지막 세션 맥락**: 가장 최근 세션 다이제스트의 `last_messages`와 `unfinished_signals`에서 식별
- **브랜치 상태**: main에 머지되지 않은 브랜치가 있으면 진행 중인 작업

**권장 다음 스텝 생성 (핵심):**

위 신호들을 종합하여 **번호 매긴 2~3개 선택지**를 제시한다. 글로벌 규칙(`~/.claude/CLAUDE.md`의 "제안 방식")에 따라:

- 각 번호에 **구체적인 작업 한 줄**
- 각 번호에 **근거 (어느 신호에서 왔는지)** 한 줄
- 각 번호에 **트레이드오프 또는 임팩트** 한 줄

추정 신뢰도가 낮은 항목(뚜렷한 신호 없음)은 `- [ ] (추정)` 프리픽스를 붙인다. 신호가 전혀 없으면 "미완료 작업 신호 없음"으로 표시한다.

### Step 4: 출력

터미널에 다음 6개 섹션을 마크다운 형태로 출력한다:

```markdown
## 1. 최근 세션 요약

### 세션 1 (2026-03-21, 브랜치: fix/wrap-up-report-enrich-output)
- 주요 작업 bullet 1
- 주요 작업 bullet 2

### 세션 2 (2026-03-20, 브랜치: fix/wrap-up-report-enrich-output)
- 주요 작업 bullet 1
- 주요 작업 bullet 2

## 2. 현재 브랜치 상태

- 브랜치: {현재 브랜치}
- main 대비: {변경 요약}
- Uncommitted: {uncommitted 파일 요약}

## 3. 최근 Git 히스토리

{git log --oneline 결과에서 주요 커밋}

## 4. 프로젝트 계획 진척도

### {문서 경로 1} — {done}/{total} ({pct}%)
- 수정 날짜: 2026-04-16
- 진행 중 섹션: {남은 작업이 많은 섹션 Top 3}
- 현재 상태 요약 발췌: {해당 섹션 첫 10줄}

### {문서 경로 2} — ...

> 계획 문서가 없으면 "프로젝트 계획 문서 없음"으로 표시

## 5. 권장 다음 스텝

1. **{작업 한 줄 요약}**
   - 근거: {어느 신호/문서에서 도출되었는지}
   - 트레이드오프: {장점 / 단점 / 임팩트}

2. **{작업 한 줄 요약}**
   - 근거: ...
   - 트레이드오프: ...

3. **{작업 한 줄 요약}** (선택)
   - 근거: ...
   - 트레이드오프: ...

## 6. 미완료 작업 신호

- [ ] 작업 항목 1
- [ ] 작업 항목 2
- [ ] (추정) 신호가 약한 작업 항목
```

---

## Boundaries

**Will:**
- 현재 프로젝트의 최근 세션 트랜스크립트를 `session-digest` 서브스킬로 격리 파싱 및 요약
- Git 상태와 히스토리 수집
- 프로젝트 계획 문서(TODO/ROADMAP/PLAN) 탐지 및 체크박스 진척도 집계
- 미완료 작업 추정 및 번호 매긴 권장 다음 스텝 제시
- 터미널에 구조화된 요약 출력

**Will Not:**
- Notion API 호출
- 메모리 파일 생성/수정
- 트랜스크립트의 assistant 메시지나 tool 결과 분석 (토큰 절약)
- 계획 문서 자체를 수정 (읽기 전용)
- 코드 수정이나 커밋

## Gotchas

| Gotcha | 증상 | 대응 |
|--------|------|------|
| **현재 세션 포함** | 자기 자신의 세션을 분석하여 무의미한 내용 포함 | 가장 최근 .jsonl 파일은 제외 |
| **대용량 트랜스크립트** | 세션당 수MB, 토큰 초과 | session-digest가 context: fork로 격리 처리 |
| **worktree 세션** | 임시 경로에서 실행된 세션은 다른 프로젝트 디렉토리에 저장됨 | PWD 기반이므로 자연스럽게 현재 프로젝트만 대상 |
| **대형 계획 문서** | `docs/**/TODO*.md`가 수천 줄이라 Read 토큰 과다 | 최근 수정 Top 3만 선택, 체크박스 통계는 grep -c로 집계 |
| **다국어 체크박스** | `- [x]`/`- [X]` 혼용 또는 공백 변형 | grep 정규식은 `^\s*-\s*\[[xX]\]` / `^\s*-\s*\[ \]` 패턴 사용 |
| **계획 문서 부재** | 레포에 TODO/ROADMAP이 없음 | Step 2.5는 "프로젝트 계획 문서 없음"으로 기록하고 넘어감 |

## Done When

- [ ] `TRANSCRIPT_DIR`에서 `.jsonl` 파일이 탐색됨
- [ ] 현재 세션 파일이 제외됨
- [ ] 최근 N개 세션의 다이제스트가 `session-digest` 서브스킬로 수집됨
- [ ] `git log` / `git status` / `git diff main --stat` 결과가 수집됨
- [ ] 프로젝트 계획 문서(TODO/ROADMAP/PLAN) Top 3 탐지 및 체크박스 진척도 집계 완료 (또는 "없음" 명시)
- [ ] 권장 다음 스텝 2~3개가 번호+근거+트레이드오프 형태로 생성됨
- [ ] 6개 섹션 (세션 요약 / 브랜치 상태 / Git 히스토리 / 계획 진척도 / 권장 다음 스텝 / 미완료 신호)이 터미널에 출력됨
