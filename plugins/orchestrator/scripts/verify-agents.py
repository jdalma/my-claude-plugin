#!/usr/bin/env python3
"""B.5 — 생성된 .claude/agents/*.md 검증

체크 항목:
1. frontmatter가 valid YAML 헤더 형식인가
2. 필수 frontmatter 필드: name, description, model, disallowedTools 존재
3. disallowedTools에 'Agent', 'Task', 'TeamCreate', 'TeamDelete' 모두 포함 (P8 강제)
4. 필수 본문 섹션 존재
5. <Domain_Knowledge>에 자동 생성 마커 포함

사용: python3 scripts/verify-agents.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Optional, List, Dict

ROOT = Path(__file__).parent.parent
AGENTS_DIR = ROOT / ".claude" / "agents"

REQUIRED_FRONTMATTER = ["name", "description", "model", "disallowedTools"]
REQUIRED_DISALLOWED = {"TeamCreate", "TeamDelete", "Agent", "Task"}
REQUIRED_SECTIONS = [
    "<Role>",
    "<Success_Criteria>",
    "<Constraints>",
    "<Tool_Usage>",
    "<Output_Format>",
    "<Failure_Modes_To_Avoid>",
    "<Domain_Knowledge>",
]
EXPECTED_AGENTS = {
    "metis", "momus", "planner", "appdev",
    "backenddev", "designer", "critic", "verifier",
}


def parse_frontmatter(text: str) -> Optional[Dict[str, str]]:
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not m:
        return None
    fm: Dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith(" ") and not line.startswith("-"):
            key, _, value = line.partition(":")
            fm[key.strip()] = value.strip()
    return fm


def verify_agent(path: Path) -> List[str]:
    errors: List[str] = []
    text = path.read_text(encoding="utf-8")

    fm = parse_frontmatter(text)
    if fm is None:
        errors.append("frontmatter parse failed")
        return errors

    for key in REQUIRED_FRONTMATTER:
        if key not in fm:
            errors.append("frontmatter missing: " + key)

    disallowed_raw = fm.get("disallowedTools", "")
    disallowed_tokens = {t.strip() for t in disallowed_raw.split(",") if t.strip()}
    missing_disallowed = REQUIRED_DISALLOWED - disallowed_tokens
    if missing_disallowed:
        errors.append("disallowedTools missing: " + str(sorted(missing_disallowed)))

    for section in REQUIRED_SECTIONS:
        if section not in text:
            errors.append("section missing: " + section)

    if "<Domain_Knowledge>" in text and "자동 생성됨" not in text:
        errors.append("Domain_Knowledge auto-generated marker missing")

    return errors


def main() -> int:
    found_files = sorted(AGENTS_DIR.glob("*.md"))
    found_names = {p.stem for p in found_files}

    missing = EXPECTED_AGENTS - found_names
    extra = found_names - EXPECTED_AGENTS

    print("발견된 에이전트: " + str(sorted(found_names)))
    if missing:
        print("  ❌ 누락: " + str(sorted(missing)))
    if extra:
        print("  ⚠️  예상 외: " + str(sorted(extra)))

    total_errors = 0
    print()
    for path in found_files:
        if path.stem not in EXPECTED_AGENTS:
            continue
        errors = verify_agent(path)
        if errors:
            print("❌ " + path.name)
            for e in errors:
                print("     - " + e)
            total_errors += len(errors)
        else:
            print("✅ " + path.name)

    print()
    if missing or total_errors > 0:
        print("실패: 누락 " + str(len(missing)) + "건, 오류 " + str(total_errors) + "건")
        return 1
    print("통과: " + str(len(EXPECTED_AGENTS)) + "개 에이전트 모두 검증 완료")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
