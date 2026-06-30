---
name: vault-ingest
description: 문서·URL·인라인 텍스트, 또는 현재 세션 컨텍스트를 memory-palace류 마크다운 vault에 흡수한다. 입력을 Source / Note / Decision 후보 / Inbox로 분류하고, 기존 Note·MOC와의 연결을 먼저 검토한 뒤, 승인 후에만 vault 구조에 맞춰 쓴다. 사용자가 "vault에 ingest", "이 문서 vault로 넣어줘", "지금 세션 의사결정 vault로 옮겨줘", "/vault-ingest" 같이 요청할 때 사용. 자동 git commit 금지.
---

# vault-ingest — vault 흡수 (분류 → 승인 → 쓰기)

> 외부 입력 또는 **현재 세션 컨텍스트**를 vault 구조에 흡수한다.
> 분류안을 먼저 제시하고 **승인 후에만** 파일을 쓴다.

이 스킬은 순수 워크플로우다 — 정적 지식(분류 기준·쓰기 순서·검증)과
파일 읽기/쓰기·grep류 검색(L0~L1)만 쓴다. 서브에이전트·MCP·세션 모델에
의존하지 않으므로 claude·codex·gemini에서 동일하게 동작한다.

> 이 스킬은 memory-palace 레포의 `.codex/skills/vault-ingest`에서 이 레포로 이관되어
> CLI-중립화되었다. codex 전용 표면(`argument-hint`, "Codex 전용" 문구, vault-decision
> MCP 도구 직접 호출)을 제거하고 vault 계약을 런타임에 읽도록 바꿨다.

## When to use

- 정리된 문서/URL/텍스트를 vault에 영속 지식으로 남기고 싶을 때
- **지금 세션에서 내린 의사결정·발견을 vault로 이관**하고 싶을 때
- raw 자료가 아직 분류 전이고, 어디에 어떻게 넣을지 판단이 필요할 때

## Input (두 가지 호출 방식)

`$ARGUMENTS`로 다음 중 하나를 받는다. **둘 다 지원한다.**

1. **명시 입력** — 파일 경로(여러 개 가능) / URL / 붙여넣은 텍스트.
   그 내용을 읽어 ingest 대상으로 삼는다.
2. **세션 컨텍스트** — 인자가 비어 있으면, **지금까지의 대화 컨텍스트**에서
   영속 가치가 있는 결정·근거·교훈을 추려 ingest 대상으로 삼는다.
   (예: "방금 우리가 내린 결정들 vault로 정리해줘")
   - 세션에서 추릴 때는 *무엇을 ingest 대상으로 봤는지* 목록을 먼저 보여주고
     사용자 확인을 받은 뒤 분류로 넘어간다. 추론으로 임의 선별하지 않는다.

## Vault 위치와 계약 (하드코딩하지 않음)

- **vault 경로**: 인자로 vault 루트가 주어지면 그것을 쓰고, 없으면 기본값
  `~/knowledge/memory-palace`. 다른 vault를 대상으로 하려면 경로를 인자로 준다.
- **계약은 vault에서 읽는다**: vault의 폴더 모델·frontmatter·파일명 규칙은
  스킬에 박아두지 않는다. 실행 시 vault 안의 규칙 문서를 읽어 그 계약을 따른다.
  (vault 규칙이 바뀌어도 이 스킬은 고칠 필요가 없다.)

## Load Order

쓰기 전 다음을 읽는다. (파일명이 없으면 동등한 역할의 문서를 vault에서 찾는다.)

1. vault 루트의 규칙 문서 (`AGENTS.md` 또는 동등물)
2. 대상 폴더의 규칙 문서 (`01 Notes/`, `03 Sources/` 등의 `AGENTS.md`)
3. 필요 시 `templates/` 의 해당 템플릿 (`note.md`, `source.md`, `decision.md`)
4. `index.md`, `log.md`, 관련 MOC

## Classification

입력은 아래 중 하나로 분류한다.

- **Source 후보** — 외부 원문/출처. 원문성을 보존해야 하는 자료.
- **Note 후보** — 내 언어로 재구성한 지식. `decision_candidates` 필드를 *유지*한다.
- **Decision 후보** — 트레이드오프를 동반한 선택. 단, ingest 단계에서는
  보통 **Note의 `decision_candidates`에 후보로만 적는다.** 독립 Decision 노트로의
  승격은 `vault-atomize`가 판단한다 (성급히 Decision 파일을 만들지 않는다).
- **Inbox 유지** — 아직 분류가 이른 raw 입력. 기본 query 경로에는 넣지 않는다.

## Required Behavior

- **먼저 기존 노트를 찾는다.** 새 파일보다 기존 Note 확장 / 기존 MOC 연결을 우선한다.
- Note에는 `decision_candidates` 필드를 유지한다 (비어 있어도 둔다).
- Decision 노트에는 `decision_candidates`를 넣지 않는다.
- Query 기본 경로에 Inbox를 넣지 않는다.
- 변경이 **실제 vault knowledge에 해당할 때만** `index.md`, `log.md`, MOC를 갱신한다.
- 구현 계획·마이그레이션 문서(예: `docs/plans/`)는 vault knowledge로 취급하지 않는다.
- provenance를 남긴다: 외부 출처면 `[[Source]]`로, 자기 합성이면 `["self"]`로.

## Write Order

1. 입력 분석 (명시 입력 또는 세션 컨텍스트)
2. 기존 노트 / MOC 확인 (중복·근접 중복 탐색)
3. 분류안 제시 — **여기서 멈추고 승인을 받는다**
4. 승인 후 작성
5. provenance 링크 반영
6. 실제 vault knowledge 변화일 때만 `index.md`, `log.md`, MOC 갱신
7. 결과 검증

## Verification

- frontmatter가 대상 폴더 규칙 문서 계약과 맞는가
- `[[링크]]`가 끊기지 않았는가
- `index.md`, MOC, `log.md` 갱신이 실제 vault knowledge 변화에만 한정되었는가
- 세션 컨텍스트에서 추린 경우, 사용자가 확인한 항목만 들어갔는가
