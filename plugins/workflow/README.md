# workflow plugin

개인 Claude Code 워크플로우 스킬·커맨드 모음. 여러 PC에서 동일 환경을 쓰기 위한 모듈.

## 설치

```
/plugin marketplace add https://github.com/jdalma/my-claude-plugin
/plugin install workflow@my-claude-plugin
```

## 작성 규칙

- 커맨드: `commands/<name>.md` — frontmatter(`name`, `description`, `disable-model-invocation: true`) 필수
- 스킬: `skills/<name>/SKILL.md` — `description` 필드 트리거 문구가 자동 매칭에 사용됨

## 불변식 검사 — 4-에셋 상태 책임 매트릭스

`plan` / `slice-tdd` / `handoff` / `takeover` 네 스킬은 동일한 "상태 갱신 책임 매트릭스" 표를 본문에 중복 보유한다. 한 곳만 고치면 나머지가 drift 하므로(실제로 `takeover`가 `slice-tdd`를 옛 이름 `tdd`로 적은 적 있음), 불변식을 테스트로 강제한다:

```bash
node plugins/workflow/lib/check-state-matrix.mjs   # exit 0=일치, 1=drift (각 스킬의 자기 역할 볼드 강조만 허용)
```

4곳 매트릭스 중 한 곳을 수정했다면 이 검사기를 돌려 나머지 3곳도 맞췄는지 확인한다.

## 금지

도메인 정보(회사·팀·고객·내부 시스템 식별자)를 포함한 자산은 절대 커밋하지 않는다. public 레포이므로 한 번 push되면 회수가 어렵다.
