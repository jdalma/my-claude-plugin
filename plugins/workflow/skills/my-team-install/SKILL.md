---
name: my-team-install
description: Install the my-team CLI binary from this repo's tools/my-team package so the my-team skill can actually invoke commands. Use when the user explicitly invokes /my-team-install, or when the my-team skill is about to run but `command -v my-team` fails. Never run this automatically — wait for explicit user invocation or for my-team skill to ask the user to call it first.
aliases: []
---

# my-team-install — CLI 도구 설치

`my-team` 슬래시 커맨드가 실제로 동작하려면 `my-team` CLI 바이너리가 PATH에 있어야 한다. 이 스킬은 `tools/my-team` npm 패키지를 사용자 시스템에 설치한다.

## ⛔ 호출 규칙

- ✅ 사용자가 명시적으로 `/my-team-install` 호출
- ✅ `my-team` 스킬이 첫 실행에서 `command -v my-team` 실패를 발견하고 사용자에게 "/my-team-install 먼저 호출하세요" 안내한 후, 사용자가 그걸 받아 호출
- ❌ 자동 호출 금지 (npm install + npm link는 시스템 PATH에 심링크 생성하는 변경이라 사용자 명시 동의 필요)

## 실행 흐름

### Step 1: 기존 설치 확인

```bash
command -v my-team && my-team --version 2>/dev/null || echo "not installed"
```

- 이미 PATH에 있고 `--version`이 동작하면: "이미 설치됨 (버전 X)" 출력 후 종료
- 없으면 Step 2로

### Step 2: my-claude-plugin 레포 위치 확인

이 CLI는 `<repo>/tools/my-team/` 안에 있다. 사용자가 이 레포를 이미 clone했는지 확인:

```bash
# 가장 흔한 위치 확인 (사용자 환경에 맞게 후보 추가)
for candidate in \
    ~/IdeaProjects/my-claude-plugin \
    ~/Projects/my-claude-plugin \
    ~/code/my-claude-plugin \
    ~/src/my-claude-plugin; do
  if [ -d "$candidate/tools/my-team" ]; then
    echo "found: $candidate"
    break
  fi
done
```

- 발견되면 그 경로를 사용
- 없으면 사용자에게 묻기:
  ```
  my-claude-plugin 레포를 어디에 clone할까요?
  기본: ~/IdeaProjects/my-claude-plugin

  답변 후:
    git clone https://github.com/jdalma/my-claude-plugin.git <path>
  ```

### Step 3: npm install + npm link

```bash
cd <repo>/tools/my-team
npm install
npm link
```

`npm link`는 `~/.npm-global/bin/` 또는 `/usr/local/bin/`에 `my-team` 심링크를 만든다. 시스템 권한에 따라 `sudo`가 필요할 수도 있다.

### Step 4: 검증

```bash
command -v my-team
my-team --version
my-team --help | head -5
```

세 명령 모두 성공해야 한다. 실패 케이스:
- `my-team: command not found` → npm 글로벌 bin 디렉토리가 PATH에 없음. `npm config get prefix`로 확인 후 PATH 추가 안내
- `npm link` 권한 오류 → `sudo npm link` 또는 `npm config set prefix ~/.npm-global` 후 재시도 안내

### Step 5: 사용자에게 완료 보고

```
✅ my-team CLI 설치 완료
   위치: <bin path>
   버전: <version>

이제 /my-team 스킬을 호출하면 워커 부팅·메시지 전송 등이 동작합니다.
```

## 사용자에게 묻는 질문 예시

설치 위치 결정 시:
- "my-claude-plugin 레포가 이미 있나요? 있으면 절대경로를, 없으면 어디에 clone할지 말씀해주세요. (기본: `~/IdeaProjects/my-claude-plugin`)"

기존 my-team이 다른 버전으로 설치되어 있을 때:
- "기존 my-team 바이너리가 발견되었습니다 (위치: `...`, 버전: `...`). 덮어쓸까요? (y/n)"

## Done When

- `command -v my-team` 출력이 존재함
- `my-team --version` 이 정상 출력 (예: `0.1.0`)
- `my-team --help` 가 6개 명령(start/status/msg/add-task/shutdown/monitor + api) 표시
- 사용자에게 설치 완료 메시지 출력됨

## Edge Cases

| 상황 | 대응 |
|---|---|
| `npm`이 PATH에 없음 | "Node.js 20+ 설치 필요. https://nodejs.org" 안내 후 중단 |
| `git`이 PATH에 없음 | "git 설치 필요" 안내 후 중단 |
| 사용자가 이미 다른 도구로 my-team을 설치함 | Step 1에서 감지. 덮어쓰기 여부 물음 |
| npm link 권한 거부 | `npm config set prefix ~/.npm-global` + `export PATH=~/.npm-global/bin:$PATH` 안내 |
| 사용자가 레포 위치 입력을 거부 | 설치 중단, "수동 설치 방법: README 참조" 출력 |
| Windows | (현재 미지원 — tmux 자체가 unix 도구. 안내만 하고 중단) |

## 참고

- 이 CLI는 npm registry에 publish되지 않은 로컬 패키지다. 표준 `npm install -g my-team` 으로 받을 수 없다.
- 향후 npm publish 결정이 나면 이 SKILL의 Step 2-3을 단순화 (한 줄 npm install -g)할 수 있다.
- my-team 본 스킬(`/my-team`) 호출 시 CLI 미설치 상태이면, my-team SKILL.md가 사용자에게 "/my-team-install 먼저 호출하세요"라고 안내해야 한다.
