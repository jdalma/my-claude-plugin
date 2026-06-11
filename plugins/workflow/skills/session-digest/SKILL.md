---
name: session-digest
description: "[내부 서브스킬 전용] catch-up 커맨드가 Skill tool로 호출하는 전용 서브스킬. 단일 세션 트랜스크립트(.jsonl) 파일을 파싱해 구조화된 요약 JSON을 리턴한다. 사용자 요청·자동 트리거로는 절대 선택하지 말 것 — 오직 catch-up 커맨드의 Step 2에서만 사용."
context: fork
user-invocable: false
---

# 세션 다이제스트

> **context: fork** — 서브에이전트에서 격리 실행됩니다. 세션 트랜스크립트 원문(수천~수만 자)이 부모 컨텍스트를 오염시키지 않고, 구조화된 요약만 리턴합니다.

## Input

$ARGUMENTS

## 입력 필드

| 필드 | 설명 | 필수 |
|------|------|------|
| `session_file` | 세션 JSONL 파일 절대 경로 | Y |

## Behavioral Flow

```
세션 파일 경로 수신 → [1.user 메시지 추출] → [2.요약 생성] → 리턴 (JSON)
```

### 1단계: user 메시지 추출

입력의 `session_file` 값을 `SESSION_FILE` 변수로 설정한 뒤, Bash 도구로 Python 인라인 스크립트를 실행하여 user 메시지를 추출합니다:

```bash
SESSION_FILE="{session_file 입력값}"
python3 - "$SESSION_FILE" << 'PYEOF'
import json
import sys
import os

filepath = sys.argv[1]
messages = []
session_id = ""
timestamp = ""
git_branch = ""

with open(filepath, "r") as f:
    first_line = True
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        if first_line:
            timestamp = obj.get("timestamp", "")
            git_branch = obj.get("gitBranch", "")
            session_id = obj.get("sessionId", "")
            first_line = False

        if obj.get("type") != "user":
            continue

        content = obj.get("message", {}).get("content", "")
        text = ""

        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            text_parts = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    text_parts.append(item.get("text", ""))
            text = "\n".join(text_parts)

        if not text:
            continue

        skip_prefixes = ("<command-message>", "<system-reminder>", "Base directory for this skill:")
        if any(text.lstrip().startswith(prefix) for prefix in skip_prefixes):
            continue

        messages.append(text)

if not session_id:
    session_id = os.path.basename(filepath).replace(".jsonl", "")

# Truncation: >20 messages → first 5 + last 10
if len(messages) > 20:
    omitted = len(messages) - 15
    truncated = messages[:5]
    truncated.append(f"... ({omitted}개 메시지 생략)")
    truncated.extend(messages[-10:])
    messages = truncated

print(f"SESSION_ID: {session_id}")
print(f"TIMESTAMP: {timestamp}")
print(f"BRANCH: {git_branch}")
print(f"TOTAL: {len(messages)}")
print("---MESSAGES---")
for i, msg in enumerate(messages, 1):
    compact = msg.replace("\n", " ").strip()
    if len(compact) > 500:
        compact = compact[:500] + "..."
    print(f"[{i}] {compact}")
PYEOF
```

### 2단계: 요약 생성

추출된 user 메시지를 분석하여 다음을 생성합니다:

1. **주요 작업**: 해당 세션에서 수행한 작업을 2~5개 bullet point로 요약
2. **마지막 메시지**: 세션의 마지막 user 메시지 2-3개 (50자 이내 요약)
3. **미완료 신호**: "다음에 할 것", "TODO", 진행 중이던 논의 등 식별

### 리턴 형식

```json
{
  "session_id": "abc123",
  "date": "2026-03-21T14:30:00",
  "branch": "feat/domain-sync",
  "summary_bullets": [
    "domain:sync 스킬 설계 및 구현",
    "domain:setup에 스마트 모드 추가"
  ],
  "last_messages": [
    "커밋해줘",
    "domain:sync 테스트 어떻게 할지 고민 중"
  ],
  "unfinished_signals": [
    "domain:sync 테스트 미완료"
  ]
}
```

**메시지가 없는 세션:**
```json
{
  "session_id": "abc123",
  "date": "2026-03-21T14:30:00",
  "branch": "main",
  "summary_bullets": ["user 메시지 없음 (시스템 세션)"],
  "last_messages": [],
  "unfinished_signals": []
}
```

## Tool Coordination

| 도구 | 용도 | 필수 | 단계 |
|------|------|------|------|
| **Bash** | Python 인라인 스크립트로 JSONL 파싱 | Y | 1 |
