---
name: vault-capture
description: 정형화되지 않은 raw 정보 — 정리 안 된 문서·붙여넣은 텍스트·현재 세션 컨텍스트 — 를 분류하지 않고 memory-palace류 vault의 Inbox에 status:raw로 빠르게 포획한다. 분류·연결·승격은 하지 않는다(그건 vault-ingest의 일). 사용자가 "이거 일단 inbox에 넣어둬", "정리는 나중에, 일단 담아줘", "지금 세션 내용 캡처해줘", "/vault-capture" 같이 요청할 때 사용. 자동 git commit 금지.
---

# vault-capture — raw 정보 → Inbox 빠른 포획

> 정형화되지 않은 정보를 **분류하지 않고** Inbox에 `status: raw`로 떨어뜨린다.
> 입구는 가볍게, 정제는 나중에. vault 수명주기에서 가장 앞단의 진입점이다.

```
raw 정보 ──[capture]──▶ Inbox(status:raw) ──[ingest]──▶ Source/Note ──[atomize]──▶ Decision
          (이 스킬)                          └──────────[prune]──────────┘
```

이 스킬은 순수 워크플로우다 — 정적 지식(포획 규칙·쓰기 순서)과 파일 읽기/쓰기·
grep류 검색(L0~L1)만 쓴다. 서브에이전트·MCP·세션 모델에 의존하지 않으므로
claude·codex·gemini에서 동일하게 동작한다.

## vault-ingest와의 경계 (가장 중요)

`vault-capture`와 `vault-ingest`는 책임이 다르다. 섞지 않는다.

| | vault-capture (이 스킬) | vault-ingest |
|---|---|---|
| 목적 | **담기** (quick capture) | **분류·연결·흡수** |
| 결과 위치 | `00 Inbox/` (status:raw) | `01 Notes/`·`03 Sources/` 등 vault 본체 |
| 분류 | 안 한다 | Source/Note/Decision후보/Inbox로 분류 |
| 기존 노트 연결 | 안 한다 | 먼저 찾아 연결한다 |
| index/log/MOC 갱신 | **안 한다** (Inbox는 vault knowledge 아님) | 실제 knowledge 변화면 갱신 |
| 승인 게이트 | 가볍게 (무엇을 담을지 목록 확인) | 분류안 승인 필수 |

판단 기준: **분류할 준비가 됐으면 vault-ingest, 아직 raw면 vault-capture.**
정리 안 된 문서·세션 컨텍스트처럼 정형화 전 정보는 보통 capture가 맞다.
capture로 담은 뒤, 나중에 `vault-ingest`가 Inbox를 소화한다.

## When to use

- 정리 안 된 문서/메모/붙여넣은 텍스트를 일단 안전하게 받아두고 싶을 때
- "정리는 나중에, 지금은 잃어버리지만 않게" 담고 싶을 때
- **지금 세션에 쌓인 컨텍스트**를 raw 그대로 떨어뜨려 두고 싶을 때

## Input (두 가지 호출 방식)

`$ARGUMENTS`로 다음 중 하나를 받는다. **둘 다 지원한다.**

1. **명시 입력** — 파일 경로(여러 개 가능) / URL / 붙여넣은 텍스트.
2. **세션 컨텍스트** — 인자가 비어 있으면, 지금까지의 대화에서 남겨둘 가치가 있는
   내용을 raw로 포획한다.
   - 세션에서 추릴 때는 *무엇을 담을지* 목록을 먼저 보여주고 사용자 확인을 받는다.
     단, 여기서 분류하거나 정제하지 않는다 — "담을지 말지"만 확인한다.

## Vault 위치와 계약 (하드코딩하지 않음)

- **vault 경로**: 인자로 주어지면 그것을, 없으면 기본값 `~/knowledge/memory-palace`.
- **Inbox 계약은 vault에서 읽는다**: Inbox 폴더의 규칙 문서를 실행 시 읽어
  frontmatter·상태값·파일명 규칙을 그대로 따른다 (스킬에 박아두지 않는다).
  일반적으로 `type: note | source`, `status: raw`를 최소 frontmatter로 둔다.

## Load Order

쓰기 전 다음을 읽는다. (파일명이 없으면 동등한 역할의 문서를 vault에서 찾는다.)

1. vault 루트의 규칙 문서 (`AGENTS.md` 또는 동등물)
2. Inbox 폴더 규칙 문서 (`00 Inbox/AGENTS.md`) — 허용 콘텐츠·frontmatter·status:raw 계약

## Capture Rules

- **분류하지 않는다.** Source/Note/Decision 판단은 ingest로 미룬다.
- **기존 노트와 연결하지 않는다.** backlink·MOC 연결은 하지 않는다.
- **over-atomize 금지.** 거친 메모 하나를 여러 파일로 쪼개지 않는다 — 한 입력은
  보통 한 Inbox 파일로 담는다.
- `index.md`·`log.md`·MOC를 **갱신하지 않는다.** Inbox는 기본 query 경로도, vault
  knowledge도 아니다.
- frontmatter는 Inbox 계약의 최소 형태(`status: raw`)로만 채운다. 분류가 불명확하면
  `type: note`, `status: raw`를 기본으로 둔다.
- 원문성을 보존한다. raw 입력을 capture 단계에서 재작성·요약하지 않는다.

## Write Order

1. 입력 확보 (명시 입력 또는 세션 컨텍스트)
2. 무엇을 담을지 목록 제시 — 가벼운 확인을 받는다 (분류는 하지 않음)
3. Inbox 계약에 맞는 최소 frontmatter로 `00 Inbox/`에 파일 작성
4. 결과 보고 — 담은 파일 경로와, 다음에 `vault-ingest`로 소화하면 된다는 안내

## Verification

- 파일이 `00 Inbox/`(또는 vault의 Inbox 역할 폴더)에 들어갔는가
- frontmatter가 Inbox 규칙 문서 계약(`status: raw` 등)을 만족하는가
- `index.md`·`log.md`·MOC를 건드리지 않았는가 (capture는 vault knowledge를 안 만든다)
- raw 입력을 임의로 분류·정제·재작성하지 않았는가
