# Orchestrator 후속 작업 추적 — v2.1 / v3 TODO

**최초 작성**: 2026-04-21
**최종 갱신**: 2026-04-21 (세션 종료 시점)
**용도**: 다음 세션에서 이어 작업할 수 있도록 현재 진행 상황 + 대기 항목 기록

---

## 우선순위

- 🔴 **MUST** — 즉시 착수 대상 (v2.1)
- 🟡 **SHOULD** — 가까운 시점 대상
- 🟢 **MAY** — v3 또는 그 이후

---

## 🟢 현재까지 완료된 것 (회고용 스냅샷)

v2 설계·구현까지 완료된 상태. Phase A + B + C 전부 통과. 자세한 산출물:

- `docs/design/orchestrator-v2.md` — 설계 문서 (대표 결정 13개 반영 완료)
- `knowledge/principles.md` — P1~P8 원칙
- `knowledge/decisions/` — 6개 결정 문서
- `schemas/` — 7개 JSON Schema (모두 valid)
- `CLAUDE.md` — v2 규약 전면 반영 (440줄)
- `.claude/skills/orch-*/` — 5개 우리 자산 스킬
- `.claude/agents/templates/` — 8개 템플릿 (metis/momus 포함, disallowedTools 강제)
- `.claude/agents/*.md` — 8개 에이전트 자동 생성 (검증 통과)
- `scripts/build-agents.py`, `verify-agents.py`, `pilot-run.py` — 회귀 테스트 자동화

---

## 🔴 다음 세션 즉시 착수 — Discord 양방향 채널 통합 (v2.1)

### 배경

- 대표가 Claude Code의 공식 **Channels 기능** (v2.1.80+)을 활용해 Discord에서 진행 상황 확인 + 의사결정 답변 받기를 원함
- 계정: claude.ai oauth 인증 완료, Claude Code v2.1.116, Bun 설치됨
- fakechat 데모는 **양방향 동작 확인됨** (2026-04-21)
- 공식 `discord@claude-plugins-official` 플러그인 아직 미설치

### 대표 결정 사항 (확정)

| 축 | 결정 |
|---|---|
| Q1 | 양방향 (publish + subscribe) |
| Q2 | **공식 Channels 기능 사용** (Anthropic 공식 Discord 플러그인) |
| Q3 publish 단위 | 에이전트 완료 / 산출물 작성 시 + 의사결정 필요 시 |
| Q4 답변 수신 | 데몬 방식 — Discord → `decisions-reply.md` 파일 append → Lead가 감지 |

### 참고 URL

- 공식 docs: https://code.claude.com/docs/ko/channels
- Discord 플러그인 소스: https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord

### 작업 체크리스트 (사용자 행동 필요)

- [ ] **Discord Developer Portal**에서 Bot 생성 + Token 발급 + Message Content Intent 활성화
- [ ] OAuth2 URL Generator로 봇 초대 URL 생성 (권한 6종: View Channels / Send Messages / Send Messages in Threads / Read Message History / Attach Files / Add Reactions)
- [ ] 봇을 Discord 서버에 초대
- [ ] Claude Code에서 `/plugin install discord@claude-plugins-official`
- [ ] `/reload-plugins`
- [ ] `/discord:configure <token>` (토큰은 `~/.claude/channels/discord/.env`에 저장됨)
- [ ] 세션 종료 후 `claude --channels plugin:discord@claude-plugins-official`로 재시작
- [ ] Discord 봇에 DM → 페어링 코드 수신
- [ ] `/discord:access pair <code>`
- [ ] `/discord:access policy allowlist` (자기 계정만 허용)
- [ ] 봇에 DM으로 테스트 메시지 → Lead가 응답하는지 확인

### 작업 체크리스트 (Lead가 v2.1 설계·구현 시 수행)

- [ ] **v2.1 설계 문서 작성**: `docs/design/orchestrator-v2.1.md` (Discord 통합 전용)
  - Lead가 Phase 전환 시점에 Discord로 publish 하는 메커니즘 (public→reactive 모델인지, 능동 push 가능한지 검증 필요)
  - Discord 답변 → `decisions-reply.md`로 append 하는 절차
  - 다중 채널 시 (fakechat + discord 동시) 허용/차단 정책
- [ ] **에이전트 템플릿 patch**: Discord 메시지를 직접 쓰지 않도록 명시 (Lead만 담당)
- [ ] **CLAUDE.md 갱신**: Lead가 Discord 이벤트 처리 절차 명시
- [ ] **`knowledge/decisions/discord-channel-protocol.md` 작성**: publish 단위, 답변 매핑 룰
- [ ] **`schemas/` 확장 검토**: Discord 이벤트 메타데이터를 agent-result 또는 status에 포함할지
- [ ] **파일럿 런 회귀 테스트 확장**: Discord 통합 합격 기준 C8~C10 추가 (`scripts/pilot-run.py`)

### 모호한 점 (v2.1 설계 진입 시 해결 필요)

- [ ] **Lead가 Discord에 능동 push 가능한가?** 공식 docs는 "Claude는 이벤트를 읽고 회신" 표현 → reactive 모델일 가능성 높음. 만약 그렇다면 사용자가 Discord에서 먼저 ping해야 Lead가 답변. 능동 push 가능 여부를 설계 초기에 **실험으로 검증** 필요
- [ ] **Phase 전환 알림을 모아서 보낼지 매번 보낼지** — 기본 권장: 묶음 (epoch 5분) 또는 decisions.md 변경 시에만
- [ ] **다중 채널 동시 활성화 시**: `claude --channels plugin:fakechat@... plugin:discord@...` 가능한지 검증

---

## 🔴 횡단 컨벤션 — 복합 외부 I/O 오케스트레이션

### 배경

`~/.claude/CLAUDE.md` (Global Rules) 2026-04-21 갱신 기록에 **횡단 컨벤션** 섹션이 추가됨:

> 트리거 조건: 단일 유스케이스에서 DB 저장 + 외부 API 호출 / 여러 외부 시스템 순차 쓰기 / "실패하면 어떻게 되지?" 류 I/O 조합 발생 시
> 참조 문서: `~/.claude/conventions/composite-io-orchestration.md`

### orchestrator 시스템과의 관계

orchestrator의 Lead가 Discord publish + `decisions-reply.md` append + status.json 갱신 같은 **복합 I/O**를 Phase 전환 시마다 수행. 이 패턴이 위 컨벤션의 트리거 조건에 해당.

### 확인·적용 체크리스트

- [ ] `~/.claude/conventions/composite-io-orchestration.md` 전문 읽기
- [ ] orchestrator의 Lead 절차(§에이전트 실행 흐름)에 위 컨벤션 원칙이 이미 반영되어 있는지 gap analysis
  - Persist-First (DB 저장 우선): 우리 시스템은 status.json/tasks.json 갱신 먼저, Discord publish는 그 다음인지 확인
  - 단계별 상태 모델: task 상태 NEW→READY→RUNNING→REVIEW→DONE / HARD_BLOCKED가 이미 단계별로 정의됨 ✅
  - 실패 격리: `knowledge/decisions/failure-recovery.md`와 대조 — 부족한 부분 있으면 보강
  - 허용된 리스크 문서화: Discord 통신 실패 시 허용 범위 명시
- [ ] 갭 발견 시 `knowledge/decisions/composite-io-policy.md` 추가

---

## 🟡 v3 후보 (우선순위 중간)

### 1. 🔴 Hashline 편집 도입 (대표 결정 Q4 유지)

- OMO의 `LINE#ID` + xxhash3 콘텐츠 해시 편집 방식
- 보고된 효과: 편집 성공률 6.7% → 68.3%
- Implementation Phase에서 silent corruption 방지
- 참조: `oh-my-openagent/src/tools/hashline-edit/`

### 2. 🟡 autopilot QA 사이클 부분 차용 (Q12)

- verifier에 재시도 루프(N회 후 hard_blocked) 도입 여부
- autopilot의 루프 전체는 거부했지만 QA 사이클 아이디어는 유용
- 참조: OMC `autopilot`, `ultraqa` 스킬

### 3. 🟡 explore-style 에이전트 + haiku 활용

- 현재 v2는 haiku 사용 안 함
- Phase 1 Research에서 planner 보조용 explore 에이전트
- 참조: OMC `explore.md`, OMO `librarian.ts`

### 4. 🟡 OMC `omc team` CLI 스타일 도입

- 단일 세션 가정을 깨고 tmux 기반 멀티 워커 도입
- 20+ 태스크 병렬 시 고려
- 참조: OMX `crates/omx-mux/`, `omx-runtime-core/`

### 5. 🟢 OMO 추가 페르소나

- Oracle (전략 자문), Librarian (문서 검색)
- 에이전트 수 증가에 따른 라우팅 복잡도 대응

### 6. 🟢 답변 자유 텍스트 LLM 파싱 (Q8 대안)

- 현재는 `decisions-reply.md` 정규식 파싱
- LLM 기반 파싱으로 자유 텍스트 수용

### 7. 🟢 비용 측정 자동화

- 현재 summary.md는 에이전트 호출 횟수만
- 실제 토큰/달러 측정 + 임계치 경고

### 8. 🟢 외부 플러그인 동기화 정책

- 복사한 orch-* 스킬이 외부 원본 업데이트와 어떻게 싱크될지
- 3-way merge 또는 수동 리베이스

### 9. 🟢 Phase 1 Research 강화

- `orch-deep-dive` 복사 타이밍 결정
- trace → interview 2단 파이프 적용 사용 사례 축적

---

## 🟡 Lead가 다음 세션에서 기억할 것 (운영 메모)

### 세션 재개 시 첫 행동

1. 이 파일(`docs/design/v3-todo.md`) 읽기
2. `CLAUDE.md` 읽기 (v2 규약 확인)
3. `docs/design/orchestrator-v2.md` §12 (대표 결정 13건) 스캔
4. 다음 대기 항목: **Discord 양방향 통합 v2.1 설계·구현**

### 현재까지의 작업 흐름 요약 (1줄씩)

1. 세 외부 플러그인(OMC/OMX/OMO) 전수 분석 완료
2. v2 설계 문서 작성 + critic 리뷰 + 대표 결정 13건 반영
3. Phase A: principles/decisions/schemas/CLAUDE.md/orch-skills 전부 완료
4. Phase B: metis/momus 템플릿 + 기존 6 template patch + 에이전트 재생성
5. Phase C: 파일럿 런 C1~C7 모두 통과
6. fakechat 채널 양방향 동작 확인 (Bun 설치 후)
7. Discord 통합 진행 직전에 세션 종료 — **이 파일에 기록하고 중단**

### 재귀 spawn / 안티패턴 재확인 (CLAUDE.md P8)

- Lead는 직접 구현 금지
- 에이전트는 다른 에이전트 spawn 금지 (disallowedTools로 강제)
- 외부 OMC 스킬(team, autopilot, ralph 등) 호출 금지
- 위임은 `request_for_lead` 배열로만

### 런 디렉터리 정리

- `.orchestrator/runs/run-pilot-20260421-113525/` — Phase C 파일럿 런 아티팩트 (참고용 보존)
- 새 실전 런은 `run-YYYYMMDD-HHmmss` 형식으로 생성

---

## 작업 추적 메타

이 문서를 갱신할 때:
1. 새 항목은 우선순위 분류 후 추가
2. 완료된 항목은 ✅ + 완료 날짜 + 산출물 경로
3. 폐기된 항목은 ❌ + 사유
4. 다음 메이저 작업 시작 시 본 파일을 첫 번째로 확인

---

## 즉시 복기용 — 현재 상태 한 줄 요약

> **v2 전부 완료. fakechat 양방향 확인. Discord 통합(v2.1) 셋업 직전에 중단. 다음 세션에서 대표가 Discord Bot 생성/토큰 발급부터 재개.**
