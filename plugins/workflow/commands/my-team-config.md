---
name: my-team-config
description: my-team config JSON 대화형 작성 — 팀 목적·워커·extra_prompt 설정
disable-model-invocation: true
---

# /my-team-config — my-team config 대화형 생성

`tools/my-team`이 부팅에 쓰는 `<team_name>.json` 파일을 사용자와의 인터뷰로 생성한다. 부팅은 하지 않는다. 결과 파일은 사용자가 별도로 `my-team start --config <file>`로 띄운다.

## 진행 원칙

- 단계별로 진행하며 각 단계 입력을 받기 전에는 다음 단계로 넘어가지 않는다.
- 사용자가 적은 텍스트(팀 목적, 워커 합류 이유)는 **추론으로 살을 붙이지 말고 그대로 옮긴다.** 워커는 자율 에이전트이므로 사용자가 명시하지 않은 "먼저 읽어야 할 파일", "첫 산출물", "peer 의존" 등을 LLM이 임의로 만들어 박지 않는다.
- 파일 저장은 `Write` 도구로 한다 (Bash heredoc 금지 — JSON 이스케이프 부담).

## Step 1 — 가이드 + 자유서술 입력

사용자는 my-team config 스키마를 모를 수 있다. **먼저 어떤 항목을 채울지 가이드를 보여주고**, 입력 형식은 강제하지 않는다. 한 줄에 한 항목씩 자유서술로 받아 LLM이 파싱한다.

**워커 수는 따로 묻지 않는다.** 사용자가 적은 워커 목록의 개수를 그대로 워커 수로 삼는다. 워커는 불렛(`-`, `*`), 넘버링(`1.`, `2)`, `①`), "첫 번째 워커:" 같은 자연어 등 **어떤 나열 형식으로 적어도 파싱한다.**

가이드 출력 형식 (이걸 그대로 보여준다):

```
my-team config를 함께 만들어 볼게요. 아래 항목을 자유로운 형식으로 적어주세요.
(워커 수는 따로 세지 않습니다. 적어주신 워커 줄 수가 곧 팀 인원이 됩니다.)

━━ 팀 (필수) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • team_name   팀 이름            kebab-case 권장 (예: order-cache-poc)
  • team_goal   이 팀이 모인 목적   자유서술 1~3문장

━━ 워커 (필수, 원하는 만큼 줄로 나열) ━━━━━━━━━━━━━━━━━━━
  각 워커 한 줄에 아래 4가지를 담아주세요. 불렛/숫자/자연어 무엇이든 OK.
  • name        워커 식별자         [a-zA-Z0-9-]+ (예: alpha)
  • cwd         작업 디렉토리        절대경로 또는 ~/ 로 시작
  • agent_type  에이전트 종류        claude / codex / gemini / cursor
  • 합류 이유    이 워커가 맡을 일      자유서술

━━ 자동 처리 (입력 불필요) ━━━━━━━━━━━━━━━━━━━━━━━━━━
  • launch_args  agent_type별 권장값 자동 주입 (위험 플래그는 따로 확인)
  • description  합류 이유에서 한 줄 요약을 초안 생성 → 확인받음

─ 적는 방법은 자유입니다. 아래는 모두 유효한 예시입니다 ─

[예시 A — 불렛]
  팀 이름: order-cache-poc
  목적: 주문 캐시 PoC. Redis를 도입해 응답 지연을 줄인다.
  - alpha @ ~/work/api / claude — 백엔드 API 담당, 캐시 키 설계
  - beta  @ ~/work/order / codex — invalidation 로직 책임
  - gamma @ ~/work/web / gemini — 프론트 캐시 TTL UI

[예시 B — 넘버링]
  team_name order-cache-poc
  team_goal 주문 캐시 PoC. Redis로 응답 지연 단축.
  1. alpha / ~/work/api / claude / 백엔드 API·캐시 키 설계
  2. beta / ~/work/order / codex / invalidation 로직
  3. gamma / ~/work/web / gemini / 프론트 캐시 TTL UI
```

입력을 받으면 LLM이 파싱한다. **형식이 다르더라도 의미가 명확하면 그대로 진행한다.** 워커 줄을 세어 워커 수를 확정하고, 다음 경우에만 사용자에게 되묻는다.

- 필수 항목 중 명백히 누락된 게 있을 때 (예: 워커의 cwd가 어디에도 안 보임) — 누락된 항목만 짚어서 추가 질문.
- 사용자가 본문에서 인원수를 언급("3명이야")했는데 실제 적힌 워커 줄 수와 다를 때 — 어느 쪽이 맞는지 확인. (인원수 언급이 없으면 묻지 않고 적힌 줄 수로 진행한다.)

LLM이 의심스럽게 파싱한 경우(예: `agent_type`을 추측해 채운 경우)에도 한 번 더 확인한다.

## Step 2 — 검증

파싱한 결과를 **표로 한 번 보여준 뒤** 아래 항목을 자동 확인한다. 표 형식은 다음을 따른다 (워커 수는 표 하단에 합계로 노출).

```
파싱 결과 — order-cache-poc (워커 3명)

  #  name    cwd            agent    합류 이유
  ─  ──────  ─────────────  ───────  ────────────────────────
  1  alpha   ~/work/api     claude   백엔드 API 담당, 캐시 키 설계
  2  beta    ~/work/order   codex    invalidation 로직 책임
  3  gamma   ~/work/web     gemini   프론트 캐시 TTL UI

목적: 주문 캐시 PoC. Redis를 도입해 응답 지연을 줄인다.
```

표를 보여준 뒤 다음을 자동 확인한다. 위반이 있으면 **어느 워커(#번호와 name)의 무엇이 문제인지** 짚어서 1회 수정 요청한다.

- 워커 개수 1~10 (적힌 줄 수 기준)
- `name`은 `[a-zA-Z0-9-]+` 패턴, 워커 간 중복 없음
- `agent_type`은 화이트리스트(`claude` / `codex` / `gemini` / `cursor`) 안에 있음
- `cwd` 디렉토리 존재 — Bash `test -d <path>`로 확인 (틸드는 셸 확장에 맡긴다)

## Step 3 — description 초안 + 일괄 확인

각 워커의 "합류 이유/특성"으로부터 동료 Roster에 노출될 **한 줄 description**을 LLM이 초안 생성한다. 모든 워커를 한 번에 표로 보여주고 사용자가 일괄 OK 하거나 특정 워커만 수정한다.

표 형식 (이렇게 보여준다):

```
Roster에 노출될 description 초안입니다. 이대로 좋으면 'ok', 고칠 게 있으면 "2번 ~로" 처럼 알려주세요.

  #  name    description (한 줄, ≤80자)
  ─  ──────  ──────────────────────────────────────────
  1  alpha   주문 API — 캐시 키 설계 담당
  2  beta    주문 도메인 — 캐시 invalidation 책임
  3  gamma   프론트 — 캐시 TTL UI 담당
```

description 작성 가이드:
- 한 문장, 80자 이내
- "무엇을 담당하는 워커인지"가 드러나게 (예: "주문 도메인 — 캐시 invalidation 책임")
- 워커 본인이 적은 합류 이유를 압축하되, 본인이 안 쓴 사실을 추가하지 않는다.

## Step 4 — extra_prompt 조립 (자동, 사용자 입력 없음)

각 워커의 `extra_prompt`를 다음 템플릿으로 정확히 조립한다.

```
## 팀의 작업 목적
{Step 1에서 받은 team_goal — 그대로}

## 너의 역할
{이 워커의 합류 이유/특성 — Step 1에서 받은 그대로}

## 협업
팀 동료의 도움이 필요하면 Team Roster를 참고해 `my-team api send-message`로 위임하라.
```

`{...}` 외 텍스트는 변형하지 않는다. 사용자 텍스트의 마침표·줄바꿈도 유지한다.

## Step 5 — launch_args 자동 + 위험 플래그 동의

`agent_type`별로 다음을 기본 주입한다.

| agent_type | 자동 주입 launch_args |
|---|---|
| `claude` | `["--dangerously-skip-permissions"]` |
| `codex` | `["--dangerously-bypass-approvals-and-sandbox"]` |
| `gemini` | `[]` |
| `cursor` | `[]` |

위험 플래그가 들어가는 워커가 1개 이상이면 다음과 같이 동의 게이트를 한 번 띄운다.

```
다음 워커에 자동 주입되는 launch_args에는 `--dangerously-*` 플래그가 포함됩니다:
- alpha (claude): ["--dangerously-skip-permissions"]
- beta  (codex):  ["--dangerously-bypass-approvals-and-sandbox"]

이대로 진행할까요? (y/N)
N을 고르면 해당 워커들의 launch_args는 빈 배열로 저장됩니다.
```

`N`이면 위 워커들의 `launch_args`를 `[]`로 비운다. 다른 워커는 영향받지 않는다.

## Step 6 — 최종 JSON preview + 저장

최종 JSON을 코드블록으로 보여준다. 코드블록 바로 위에 `최종 config — <team_name> (워커 N명)` 한 줄을 헤더로 붙여 인원수를 마지막까지 확인할 수 있게 한다. 그 뒤 "저장할까요? (y/N)"로 1회 확인 받는다. 키 순서는 `team_name`, `workers[].{name, cwd, agent_type, launch_args, description, extra_prompt}` 고정.

저장 경로 규칙:

1. 기본: `<현재 cwd>/<team_name>.json`
2. 이미 같은 이름의 파일이 있으면 **확인 없이** `<현재 cwd>/<team_name>-YYYYMMDDHHMM.json`로 fallback (분 단위 timestamp)
3. 저장 후 실제 경로를 사용자에게 그대로 보여준다. timestamp suffix가 붙은 경우 "기존 파일이 있어 새 이름으로 저장했습니다"를 1줄 덧붙인다.

`my-team start`로 자동 발견되는 기본 파일명은 `my-team.json`이므로, `team_name`이 `my-team`이 아니면 사용자가 부팅할 때 `--config ./<file>`를 명시해야 한다는 점을 종료 메시지에 1줄로 안내한다.

## 중간 분기 — 워커 추가/제거

인터뷰 도중 사용자가 워커를 추가하거나 제거하고 싶다고 하면 Step 1로 돌아가 워커 목록을 다시 받는다. Step 3 이후의 description 초안은 새 목록 기준으로 재생성한다.

## 종료 후

이 커맨드는 부팅하지 않는다. 마지막 메시지에 다음 부팅 명령을 그대로 안내한다.

```
my-team start --config <저장 경로>
```
