# Agent Spawning Rules — 재귀 spawn 금지 + 위임 요청

## 결정

**에이전트는 다른 에이전트나 런타임 모드를 spawn하지 않는다.** Lead만 spawn 권한을 가진다 (P8).

## 1. 강제 메커니즘

### 1.1 frontmatter 레벨 (1차 방어)

모든 `.claude/agents/*.md`의 frontmatter에 다음을 명시:

```yaml
disallowedTools: TeamCreate, TeamDelete, Agent, Task
```

이 도구들은 Claude Code 런타임 레벨에서 호출 차단된다.

### 1.2 외부 OMC 스킬 호출 금지 (2차 방어)

다음 OMC 스킬은 내부적으로 다른 에이전트/스킬을 spawn하므로 호출 금지:

| 금지 스킬 | 이유 |
|---|---|
| `team` | tmux 워커 spawn |
| `autopilot` | 다단계 자동 실행 |
| `ralph` | 자기참조 루프 |
| `ultrawork` | 병렬 spawn 엔진 |
| `self-improve` | 진화 루프 |
| `ccg` | 3중 모델 호출 |

각 에이전트 템플릿의 `<Tool_Usage>` 섹션 "사용 금지" 목록에 명시.

### 1.3 사후 감사 (3차 방어)

critic이 Phase 4에서 도구 사용 로그를 검토하여 위반 적발 시:
- 해당 에이전트 결과를 무효화 (REVIEW로 되돌림)
- Lead가 재호출 (다른 에이전트에 위임 또는 직접 처리)

## 2. 위임이 필요할 때 — `request_for_lead`

에이전트가 자기 영역 밖의 작업이 필요하다고 판단하면, **직접 spawn하지 말고** result.json의 `request_for_lead` 배열에 요청을 기록한다.

### 형식

```json
{
  "task_id": "task-007",
  "agent": "backenddev",
  "status": "DONE",
  "summary": "API 구현 완료. 단, 디자인 일관성 검토 필요.",
  "request_for_lead": [
    {
      "kind": "delegate",
      "to_agent": "designer",
      "reason": "API 응답 포맷이 기존 디자인 컨벤션을 따르는지 확인 필요",
      "context": "응답 필드 naming convention 확인",
      "priority": "low"
    },
    {
      "kind": "spawn_skill",
      "skill_name": "orch-verify",
      "reason": "통합 테스트 실행 필요",
      "priority": "high"
    }
  ]
}
```

### `kind` 종류

| kind | 의미 | Lead의 처리 |
|---|---|---|
| `delegate` | 다른 에이전트에 후속 작업 위임 | tasks.json에 신규 태스크 추가 |
| `spawn_skill` | 우리 자산 스킬(`.claude/skills/orch-*`) 호출 | Lead가 적절한 시점에 스킬 invoke |
| `info` | 단순 보고 (action 불필요) | summary.md에 기록만 |

## 3. 예외

다음만 에이전트 차원에서 허용:

- `mcp__plugin_oh-my-claudecode_t__lsp_*` — LSP 도구 (코드 분석, 읽기 전용)
- `mcp__plugin_oh-my-claudecode_t__ast_grep_search` — 패턴 검색
- `mcp__plugin_oh-my-claudecode_t__notepad_*` — 작업 노트
- `mcp__context7__*` — 외부 문서 조회
- 기타 읽기/검색 전용 도구

이 도구들은 spawn이 아니라 **데이터 조회**이므로 허용.

## 적용 범위

- 모든 에이전트의 frontmatter 작성 시
- Lead의 사후 감사 룰
- request_for_lead 처리 로직

## 관련 에이전트

- 전체 에이전트 (방어 적용)
- critic (사후 감사 주체)
- Lead (위임 요청 처리 주체)

## 참고

- `docs/design/orchestrator-v2.md` §6.4
- 핵심 원칙 P8
