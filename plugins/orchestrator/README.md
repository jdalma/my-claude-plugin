# Orchestrator

로컬 전용 개인 멀티 에이전트 오케스트레이션 작업실.

Claude Code Agent Teams를 중심으로 전문 에이전트(기획자, 앱개발자, 백엔드개발자, 디자이너, 검토자, 검증자 + 분류자 Metis / 계획 검수자 Momus)가 협업하여 큰 문제를 풀고, 모호한 지점은 Question Debt로 관리하면서 멈추지 않고 진행한다. 대표(사용자)는 Phase 경계에서만 번호 답변 프로토콜로 의사결정한다.

> **현재 버전**: v2 (2026-04-21 확정)
> **설계 문서**: [`docs/design/orchestrator-v2.md`](docs/design/orchestrator-v2.md)
> **후속 작업**: [`docs/design/v3-todo.md`](docs/design/v3-todo.md)

## 핵심 아이디어

**"모호해도 멈추지 않는다."**

- **soft ambiguity** → 가정을 세우고 계속 진행
- **hard ambiguity** → 해당 태스크만 블록, 나머지 계속
- **의사결정 대시보드** (`decisions.md`) → Phase 경계마다 대표에게 번호 답변 요청
- **의사결정 제출 ≠ 실행 중단** (P7) → 실행 가능한 태스크는 계속 진행

## 6단계 Phase

| Phase | 이름 | 주체 |
|---|---|---|
| 0 | Triage (요청 모호성 사전 분류) | Metis |
| 1 | Research (기존 코드/문서 탐색) | planner |
| 2 | Synthesis (plan.json 확정) | Lead |
| 2.5 | Plan Review (plan 실행 가능성 검수) | Momus |
| 3 | Implementation | appdev / backenddev / designer |
| 4 | Verification | verifier + critic |
| 5 | Reporting (decisions.md / summary.md 최종화) | Lead |

## 구조

```
사용자 (대표)
  ↓  번호 답변 프로토콜
Claude Code Lead Session
  ├── 분류/검수 레이어: Metis, Momus
  ├── 실무 레이어: planner, appdev, backenddev, designer, critic, verifier
  └── 참조 자산: .claude/skills/orch-* (외부 플러그인에서 복사된 우리 자산 스킬)
```

## 주요 디렉터리

```
CLAUDE.md                          - 런타임 규약 (모든 세션에서 자동 로드)
docs/design/                       - 설계 문서 (orchestrator-v2.md, v3-todo.md)
knowledge/
  principles.md                    - P1~P8 핵심 원칙
  decisions/                       - 구체적 의사결정 기록 (6개)
  agent-mapping.json               - 에이전트별 지식 매핑
schemas/                           - JSON Schema 7개
.claude/
  agents/                          - 최종 에이전트 정의 (자동 생성)
  agents/templates/                - 에이전트 템플릿
  skills/orch-*/                   - 우리 자산 스킬 (외부에서 복사)
scripts/
  build-agents.py                  - 에이전트 진화 파이프라인 자동화
  verify-agents.py                 - 생성 결과 검증
  pilot-run.py                     - Phase C 회귀 테스트
.orchestrator/runs/{run-id}/       - 런 단위 아티팩트
```

## 사용 방법

1. 이 디렉터리에서 `claude` 세션 시작 (전역 CLAUDE.md + 프로젝트 CLAUDE.md 자동 로드)
2. 큰 문제를 지시
3. Lead가 6단계 Phase를 수행
4. Phase 경계에서 `decisions.md`에 의사결정 요청이 누적되면 번호로 답변 (`Q1: 2, Q2: a, Q3: 보류`)
5. 결과는 `.orchestrator/runs/{run-id}/summary.md`에 기록

## 개발 · 회귀 테스트

```bash
# 에이전트 재생성 (templates/decisions 변경 시)
python3 scripts/build-agents.py

# 생성 결과 검증
python3 scripts/verify-agents.py

# Phase C 합격 기준 회귀 테스트 (C1~C7)
python3 scripts/pilot-run.py
```

## 향후 계획 (v2.1 / v3)

- **v2.1**: Discord 양방향 채널 통합 (Claude Code 공식 Channels 기능 기반)
- **v3**: Hashline 편집 도입 / autopilot QA 사이클 차용 / haiku 활용 explore 에이전트 등

자세한 후속 작업 목록: [`docs/design/v3-todo.md`](docs/design/v3-todo.md)

## 라이선스

개인 프로젝트.
