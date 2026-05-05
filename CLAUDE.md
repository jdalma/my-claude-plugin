# CLAUDE.md

## 프로젝트 개요

개인 Claude Code 워크플로우 하네스. 여러 PC에서 동일한 스킬·커맨드 환경을 쓰기 위한 public 마켓플레이스.

등록된 모듈:
- `plugins/workflow/` — 개인 워크플로우 자산 (도메인 정보 미포함)

## 운영 원칙

- **public 레포**: 한 번 push되면 회수가 어렵다. 회사·팀·고객·내부 시스템 식별자가 들어가는 자산은 절대 커밋하지 않는다.
- **플러그인 자산만**: `~/.claude/settings.json`, 글로벌 `CLAUDE.md` 같은 dotfiles는 별도 트랙으로 관리한다.

## 로컬 개발 워크플로우

### 플러그인 캐시 구조

Claude Code는 플러그인을 **커밋 해시 기반 디렉토리**에 캐싱한다:
```
~/.claude/plugins/cache/my-claude-plugin/workflow/{commit-hash}/
```

`.orphaned_at` 파일이 없는 디렉토리가 **active** 버전이다.

### 로컬 변경사항 테스트

SessionStart 훅이 개발 레포에서 active 캐시 디렉토리로 rsync한다 (`~/.claude/settings.json`):

```bash
bash -c 'shopt -s nullglob; src="$HOME/IdeaProjects/my-claude-plugin/plugins/workflow/"; [ -d "$src" ] || exit 0; for d in "$HOME/.claude/plugins/cache/my-claude-plugin/workflow"/*/; do [ -f "$d/.orphaned_at" ] && continue; rsync -a --delete "$src" "$d" 2>/dev/null; done' || true
```

가드:
- `shopt -s nullglob` — 캐시 디렉토리가 아직 없을 때 리터럴 글롭으로 인한 오작동 차단
- `[ -d "$src" ]` — 레포가 아직 clone되지 않은 PC에서도 안전

**IMPORTANT**: 커맨드/스킬을 추가하거나 수정한 후 **새 세션을 열어야** 반영된다.

### 다른 PC 셋업

1. `git clone https://github.com/jdalma/my-claude-plugin ~/IdeaProjects/my-claude-plugin`
2. Claude Code에서 `/plugin marketplace add https://github.com/jdalma/my-claude-plugin`
3. `/plugin install workflow@my-claude-plugin`
4. `~/.claude/settings.json`에 위 SessionStart 훅 등록

## 커맨드 작성 규칙

- **위치**: `plugins/workflow/commands/{name}.md`
- **frontmatter 필수**: `name`, `description`, `disable-model-invocation: true`

## 스킬 작성 규칙

- **위치**: `plugins/workflow/skills/{name}/SKILL.md`
- **자동 트리거**: `description` 필드의 텍스트로 매칭 (충분히 구체적으로 작성)
- **수동 전용**: `disable-model-invocation: true` 추가
