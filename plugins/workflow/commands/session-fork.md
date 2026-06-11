---
name: session-fork
allowed-tools: Bash
description: "현재 세션을 fork하여 동일 컨텍스트의 독립 세션을 새 터미널에서 시작"
disable-model-invocation: true
---

# /session-fork - 세션 컨텍스트 Fork

현재 세션의 전체 대화 컨텍스트를 복제하여 독립적인 새 세션을 생성하고, 새 터미널에서 자동으로 시작한다.

## Usage

```
/workflow:session-fork                                     # 기본: 현재 세션을 fork
/workflow:session-fork 리팩토링 관점에서 이어가줘             # 목적 주입: fork + system prompt
/workflow:session-fork --name refactor-auth                 # 세션 이름 지정
/workflow:session-fork --name test-approach 테스트 작성해줘   # 이름 + 목적 주입
/workflow:session-fork --worktree                           # worktree fork: 코드 격리 + 세션 fork
/workflow:session-fork --worktree --name experiment 실험적으로 변경해봐  # 전부 조합
```

## Input

$ARGUMENTS

---

### Step 1: 인자 파싱

`$ARGUMENTS`에서 옵션을 파싱한다:

- `--name NAME`: fork된 세션의 표시 이름 (`/resume` 목록과 터미널 타이틀에 표시됨)
- `--worktree`: git worktree 생성 후 해당 디렉토리에서 fork
- 나머지 텍스트: **목적 (purpose)** — fork된 세션의 system prompt로 주입

파싱 규칙:
- `--name`이 없으면 `SESSION_NAME`은 빈 값 (CLI가 자동 생성)
- `--name`의 값에 공백이 포함되면 안 된다. 공백이 있으면 안내하고 중단:
  ```
  세션 이름에 공백은 사용할 수 없습니다: {값}
  하이픈(-)이나 언더스코어(_)를 사용해주세요. 예: my-fork
  ```
- `--worktree`가 있으면 `USE_WORKTREE=true`
- 옵션 플래그를 제거한 나머지 텍스트가 `PURPOSE`

### Step 2: worktree 생성 (--worktree 사용 시)

`USE_WORKTREE=true`인 경우에만 실행한다.

Bash 도구로 아래를 실행한다:

```bash
BRANCH_NAME="fork-$(date +%Y%m%d-%H%M%S)"
git worktree add -b "$BRANCH_NAME" "../$(basename $PWD)-$BRANCH_NAME" HEAD 2>&1

if [ $? -eq 0 ]; then
  FORK_DIR="$(cd "../$(basename $PWD)-$BRANCH_NAME" && pwd)"
  echo "WORKTREE_OK=$FORK_DIR"
else
  echo "WORKTREE_FAIL"
fi
```

**분기 처리:**

- `WORKTREE_FAIL`이면 사용자에게 안내하고 중단:
  ```
  ⚠️ Git worktree 생성에 실패했습니다.
  현재 디렉토리가 git 저장소인지 확인해주세요.
  --worktree 없이 다시 시도하거나, 수동으로 worktree를 생성하세요.
  ```
- `WORKTREE_OK`이면 `FORK_DIR` 값을 저장하여 Step 3에서 사용한다.

`USE_WORKTREE=false`이면 `FORK_DIR="$PWD"`로 설정한다.

### Step 3: 새 터미널에서 fork된 세션 시작

> **NOTE**: `osascript`를 사용하므로 **macOS 전용**입니다.

Bash 도구로 아래를 실행한다 (SESSION_NAME, PURPOSE, FORK_DIR은 Step 1~2에서 파싱한 값을 사용):

```bash
SESSION_NAME="${SESSION_NAME}"
PURPOSE="${PURPOSE}"
FORK_DIR="${FORK_DIR}"

CMD="cd '$FORK_DIR' && claude --continue --fork-session --dangerously-skip-permissions"

if [ -n "$SESSION_NAME" ]; then
  CMD="$CMD --name '$SESSION_NAME'"
fi

if [ -n "$PURPOSE" ]; then
  ESCAPED_PURPOSE=$(printf '%s' "$PURPOSE" | sed "s/'/'\\\\''/g")
  CMD="$CMD --system-prompt '$ESCAPED_PURPOSE'"
fi

if osascript -e "
tell application \"Terminal\"
  activate
  do script \"$CMD\"
end tell
" 2>/dev/null; then
  echo "SESSION_FORK_OK"
  echo "FORK_DIR=$FORK_DIR"
  [ -n "$SESSION_NAME" ] && echo "SESSION_NAME=$SESSION_NAME"
  [ -n "$PURPOSE" ] && echo "PURPOSE=$PURPOSE"
else
  echo "SESSION_FORK_FALLBACK"
  echo "CMD=$CMD"
fi
```

**분기 처리:**

- `SESSION_FORK_OK`가 출력되면:
  ```
  ✅ Session fork 완료!
  새 터미널에서 현재 세션의 컨텍스트를 이어받은 독립 세션이 시작됩니다.

  - 원본 세션(현재)은 그대로 유지됩니다.
  - fork된 세션에서는 이전 대화 맥락을 모두 기억합니다.
  - 두 세션은 완전히 독립적입니다.
  ```

  세션 이름이 있으면 (`SESSION_NAME`이 있으면) 위 메시지에 추가:
  ```
  🏷️ 세션 이름: "{SESSION_NAME}"
  `/resume`에서 이 이름으로 세션을 찾을 수 있습니다.
  ```

  목적 주입 시 (`PURPOSE`가 있으면) 위 메시지에 추가:
  ```
  📌 주입된 목적: "{PURPOSE}"
  fork된 세션은 위 목적에 따라 대화를 이어갑니다.
  ```

  worktree 사용 시 위 메시지에 추가:
  ```
  🌿 Worktree: {FORK_DIR}
  fork된 세션은 격리된 worktree에서 실행됩니다.
  작업 완료 후 `git worktree remove {FORK_DIR}`로 정리하세요.
  ```

- `SESSION_FORK_FALLBACK`이 출력되면, 함께 출력된 `CMD=` 값을 읽어 안내한다:
  ```
  ⚠️ 터미널 자동 열기에 실패했습니다.
  새 터미널을 열고 아래 커맨드를 직접 실행해주세요:

  {출력된 CMD 값}
  ```

## Gotchas

1. **macOS Terminal 접근 권한**: 처음 실행 시 "Terminal.app이 이 컴퓨터를 제어하도록 허용"하라는 시스템 팝업이 뜰 수 있다. 시스템 설정 > 개인정보 보호 및 보안 > 손쉬운 사용에서 Terminal.app을 허용하면 된다.

2. **iTerm2 사용자**: 이 커맨드는 Terminal.app을 열도록 되어 있다. iTerm2에서 직접 실행하려면 fallback 커맨드를 수동으로 실행하면 된다.

3. **`--fork-session` 플래그**: Claude Code CLI의 공식 플래그다. `--continue`와 조합하면 원본 세션은 그대로 두고 새 세션 ID로 분기한다. 내부적으로 JSONL 복사, 메타데이터 등록 등을 CLI가 처리한다.

4. **세션 이름 활용**: `--name`으로 지정한 이름은 `claude --resume` 인터랙티브 피커와 터미널 타이틀에 표시된다. fork 목적을 이름에 반영하면 나중에 세션을 찾기 쉽다. 예: `refactor-auth`, `test-payment`, `debug-login`.

5. **worktree 정리**: `--worktree`로 생성된 worktree는 자동 삭제되지 않는다. 작업 완료 후 `git worktree remove <경로>`로 수동 정리해야 한다.

6. **목적 주입의 한계**: `--system-prompt`로 주입된 목적은 세션의 system prompt로 설정된다. 기존 CLAUDE.md나 플러그인 지시와 함께 적용되므로, 충돌이 발생할 수 있다. 짧고 명확한 목적을 권장한다.

7. **새 세션을 열어야 반영**: 이 커맨드 파일을 수정한 후에는 새 세션을 열어야 변경사항이 적용된다 (플러그인 캐시 특성).

8. **`--dangerously-skip-permissions` 플래그**: fork된 세션은 이 플래그와 함께 시작된다. fork는 원본 세션의 컨텍스트를 이어받아 자율 작업을 계속하는 경우가 많으므로, 매번 권한 승인을 요구하면 흐름이 끊긴다. 이 플래그를 붙이면 파일 쓰기/셸 실행 등의 도구 호출이 권한 프롬프트 없이 즉시 실행된다.

   **주의사항**:
   - fork된 세션은 destructive한 작업(파일 삭제, `git reset --hard`, 원격 푸시 등)도 권한 프롬프트 없이 수행할 수 있다
   - `--worktree`와 함께 사용하는 것을 권장한다 — 격리된 worktree에서 실험적 변경이 자율 실행되어도 원본 작업 디렉토리는 안전하다
   - 민감한 작업(프로덕션 배포, 인증 정보 수정 등)에는 부적합하다. 이 경우 수동으로 fork 커맨드에서 플래그를 제거하고 실행하라

## Done When

- [ ] 새 터미널 창이 열리고 fork된 세션이 자동 시작됨
- [ ] fork된 세션에서 이전 대화 맥락을 이어받아 대화 가능
- [ ] 원본 세션(현재 세션)에 영향 없음
- [ ] 목적 주입 시: fork된 세션이 주입된 목적에 따라 대화를 시작
- [ ] 세션 이름 지정 시: `/resume`에서 해당 이름으로 세션 식별 가능
- [ ] worktree 사용 시: 격리된 worktree에서 fork 세션이 실행됨
