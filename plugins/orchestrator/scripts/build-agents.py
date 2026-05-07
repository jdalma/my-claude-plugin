#!/usr/bin/env python3
"""에이전트 진화 파이프라인 Step 4 — 빌드 자동화

templates/{agent}.tmpl.md + principles.md + 매핑된 decisions/*.md를 합성하여
.claude/agents/{agent}.md를 생성한다.

규칙:
- 템플릿의 <Domain_Knowledge> 섹션 안의 placeholder 주석을 실제 지식으로 치환
- principles.md 전체를 "## Principles" 항목으로 주입
- agent-mapping.json의 decisions 배열에 명시된 파일을 "## Decisions" 항목으로 주입
- frontmatter, 다른 섹션은 템플릿 그대로 보존

사용: python3 scripts/build-agents.py
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
TEMPLATES_DIR = ROOT / ".claude" / "agents" / "templates"
AGENTS_DIR = ROOT / ".claude" / "agents"
PRINCIPLES_PATH = ROOT / "knowledge" / "principles.md"
MAPPING_PATH = ROOT / "knowledge" / "agent-mapping.json"

DOMAIN_KNOWLEDGE_BLOCK = re.compile(
    r"<Domain_Knowledge>.*?</Domain_Knowledge>",
    re.DOTALL,
)


def read_file(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def build_domain_knowledge(agent_name: str, principles: str, decision_paths: list[str]) -> str:
    parts = [
        "<Domain_Knowledge>",
        "<!-- 자동 생성됨. scripts/build-agents.py 실행으로 갱신. 직접 수정 금지. -->",
        "",
        "## Principles",
        "",
        principles.strip(),
    ]

    if decision_paths:
        parts.extend(["", "## Decisions", ""])
        for dpath in decision_paths:
            full = ROOT / dpath
            if not full.exists():
                print(f"  WARN: missing decision file {dpath} for agent {agent_name}", file=sys.stderr)
                continue
            content = read_file(full).strip()
            parts.append(f"### {dpath}")
            parts.append("")
            parts.append(content)
            parts.append("")

    parts.append("</Domain_Knowledge>")
    return "\n".join(parts)


def build_agent(agent_name: str, mapping_entry: dict) -> None:
    template_path = TEMPLATES_DIR / f"{agent_name}.tmpl.md"
    if not template_path.exists():
        print(f"  ERROR: template missing: {template_path}", file=sys.stderr)
        return

    template = read_file(template_path)
    principles = read_file(PRINCIPLES_PATH) if mapping_entry.get("principles") else ""
    decision_paths = mapping_entry.get("decisions", [])

    domain_knowledge = build_domain_knowledge(agent_name, principles, decision_paths)

    if not DOMAIN_KNOWLEDGE_BLOCK.search(template):
        print(f"  ERROR: <Domain_Knowledge> block not found in {template_path.name}", file=sys.stderr)
        return

    output = DOMAIN_KNOWLEDGE_BLOCK.sub(domain_knowledge, template, count=1)

    out_path = AGENTS_DIR / f"{agent_name}.md"
    out_path.write_text(output, encoding="utf-8")
    print(f"  generated: .claude/agents/{agent_name}.md")


def main() -> int:
    mapping = json.loads(read_file(MAPPING_PATH))
    agents = mapping.get("mappings", {})

    print(f"Building {len(agents)} agents...")
    for name, entry in agents.items():
        build_agent(name, entry)

    print(f"\nDone. {len(agents)} agents written to {AGENTS_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
