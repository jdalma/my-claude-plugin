# my-claude-plugin

개인 Claude Code 워크플로우 하네스. 여러 PC에서 동일한 스킬·커맨드 환경을 쓰기 위한 마켓플레이스.

## 등록된 플러그인

- **workflow** — 개인 워크플로우 스킬/커맨드 모음

## 설치

```
/plugin marketplace add https://github.com/jdalma/my-claude-plugin
/plugin install workflow@my-claude-plugin
```

## 운영 원칙

- **도메인 정보 금지** — 회사·팀·고객·내부 시스템 식별자가 들어간 자산은 커밋하지 않는다. public 레포이므로 한 번 push되면 회수가 어렵다.
- **플러그인 자산만** — `~/.claude/settings.json`, `CLAUDE.md` 같은 dotfiles는 별도 트랙으로 관리한다.

## 작성 규칙

- 커맨드: `plugins/workflow/commands/<name>.md` — frontmatter(`name`, `description`, `disable-model-invocation: true`) 필수
- 스킬: `plugins/workflow/skills/<name>/SKILL.md` — `description` 필드의 트리거 문구가 자동 매칭에 사용됨

## 로컬 동기화

레포 변경 후 로컬 캐시(`~/.claude/plugins/cache/.../workflow/<hash>/`)에 반영하려면 새 Claude Code 세션을 열거나 SessionStart 훅으로 rsync한다. 자세한 동기화 패턴은 `CLAUDE.md` 참조.
