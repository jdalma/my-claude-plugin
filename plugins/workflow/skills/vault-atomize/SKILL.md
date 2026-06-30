---
name: vault-atomize
description: memory-palace류 vault의 Note에 쌓인 decision_candidates를 검토해, 장기 추적 가치가 있는 것만 독립 Decision 노트로 승격한다. 중복 후보를 정리하고, 원본 Note 본문은 불필요하게 재작성하지 않는다. 사용자가 "decision 후보 정리해줘", "이 노트의 결정 분리해줘", "Decision으로 승격", "/vault-atomize" 같이 요청할 때 사용. 자동 git commit 금지.
---

# vault-atomize — decision_candidates → Decision 승격

> Note에 누적된 `decision_candidates`를 모아 클러스터링하고,
> **장기 추적 가치가 있는 항목만** 독립 Decision 노트로 승격한다.
> `vault-ingest`가 "후보로 심은" 것을 "결정으로 거두는" 단계다.

이 스킬은 순수 워크플로우다 — 정적 지식(승격 판단·쓰기 순서·검증)과
파일 읽기/쓰기·grep류 검색(L0~L1)만 쓴다. 서브에이전트·MCP·세션 모델에
의존하지 않으므로 claude·codex·gemini에서 동일하게 동작한다.

> 이 스킬은 memory-palace 레포의 `.codex/skills/vault-atomize`에서 이 레포로 이관되어
> CLI-중립화되었다. codex 전용 표면(`argument-hint`, "Codex 전용" 문구)을 제거했다.

## When to use

- Note의 `decision_candidates`가 쌓여 독립 Decision으로 뽑아낼 때가 됐을 때
- 여러 Note에 흩어진 같은 결정 후보를 하나의 Decision으로 모으고 싶을 때
- `vault-ingest` 직후, 심어둔 후보 중 승격 대상을 골라낼 때

## Input

`$ARGUMENTS`로 다음 중 하나를 받는다.

- **빈칸** — vault 전체의 Note에서 `decision_candidates`를 수집해 검토한다.
- **Note 경로** — 그 Note의 후보만 검토한다.
- **후보 title** — 특정 후보(또는 그와 묶일 후보들)만 검토한다.

## Vault 위치와 계약 (하드코딩하지 않음)

- **vault 경로**: 인자로 주어지면 그것을, 없으면 기본값 `~/knowledge/memory-palace`.
- **계약은 vault에서 읽는다**: Decision 노트의 frontmatter·파일명 규칙(예: `Decision - `
  접두사)·필수 섹션은 스킬에 박아두지 않고, 실행 시 vault의 규칙 문서/템플릿을 읽어 따른다.

## Load Order

쓰기 전 다음을 읽는다. (파일명이 없으면 동등한 역할의 문서를 vault에서 찾는다.)

1. vault 루트의 규칙 문서 (`AGENTS.md` 또는 동등물)
2. Notes 폴더 규칙 문서 (`01 Notes/AGENTS.md`) — Note vs Decision 계약
3. Maps 폴더 규칙 문서 (`02 Maps/AGENTS.md`) — MOC 등록 계약
4. 필요 시 Decision 템플릿 (`templates/decision.md`)
5. `index.md`, `log.md`, 관련 MOC

## Purpose

- Note의 `decision_candidates`를 모은다
- 중복·근접 중복 후보를 클러스터링해 정리한다
- **장기 추적 가치가 있는 항목만** Decision으로 승격한다 (전부 승격하지 않는다)

## Required Behavior

- `decision_candidates`는 **Note에만** 존재해야 한다. Decision 노트에는 넣지 않는다.
- Decision 노트는 vault 계약이 정한 파일명·frontmatter·필수 섹션을 따른다.
- 원본 Note 본문은 불필요하게 재작성하지 않는다 (승격된 후보의 정리에 한정).
- 실제 vault knowledge 변화에 해당할 때만 `index.md`, `log.md`, MOC를 갱신한다.

## Write Order

1. 대상 Note 수집 (빈칸 / 경로 / title에 따라)
2. 후보 클러스터링 (같은 결정을 가리키는 후보 묶기)
3. 승격 / 유지 / 제거 판단 — 각 후보에 근거를 붙인다
4. 승인 리포트 제시 — **여기서 멈추고 승인을 받는다**
5. 승인 후 Decision 작성
6. 원본 Note의 `decision_candidates` 갱신 (승격된 항목 정리, 링크로 대체)
7. 실제 vault knowledge 변화일 때만 `index.md`, `log.md`, MOC 갱신
8. 결과 검증

## Verification

- 새 Decision이 Notes 폴더 규칙 문서(Decision 계약)를 만족하는가
- 원본 Note에 남은 `decision_candidates`가 올바른가 (승격분 정리됨)
- 중복 Decision을 만들지 않았는가 (기존 Decision과 근접 중복 확인)
