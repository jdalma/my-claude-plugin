# Vertical Slice + Tracer Bullet 원칙

> 출처: mattpocock `tdd` + `to-issues` 핵심 원리
> 적용: slice-tdd 스킬 Step 1-2 + /plan Step 3

## 핵심 정의

**Vertical Slice** = schema → API → UI → test 모든 레이어를 통과하는 *얇고 완전한* 종단간 경로.

**Tracer Bullet** = 슬라이스 안에서 가장 단순한 1개 behavior — 종단 경로가 작동함을 증명.

## 4대 분리 기준 (슬라이스가 충족해야 할 조건)

| # | 기준 | 의미 | 위반 시 |
|---|------|------|--------|
| 1 | **Vertical** | 모든 레이어 통과 | half-done 코드, 다음 PR 의존 |
| 2 | **Demoable** | 머지 후 단독 시연·검증 가능 | "이건 슬라이스 #3 끝나야 동작" |
| 3 | **Narrow** | 1-3일 내 완료 | 컨텍스트 폭발, 무한 grill |
| 4 | **AFK 우선** | 사람 결정 없이 머지 가능 | HITL 강제, 병렬화 불가 |

→ 4개 모두 ✅이 아니면 더 쪼개거나 grill 부족.

## Vertical vs Horizontal — 시각화

### ❌ Horizontal (안티패턴)
```
┌──────────┬──────────┬──────────┬──────────┐
│ Schema   │ Schema   │ Schema   │ Schema   │ ← 슬라이스 1
├──────────┼──────────┼──────────┼──────────┤
│ API      │ API      │ API      │ API      │ ← 슬라이스 2
├──────────┼──────────┼──────────┼──────────┤
│ UI       │ UI       │ UI       │ UI       │ ← 슬라이스 3
└──────────┴──────────┴──────────┴──────────┘
```
**문제**: 슬라이스 3 끝나야 데모 가능. 중간 멈춤 = 죽은 코드.

### ✅ Vertical (Tracer Bullet)
```
┌──────┐┌──────┐┌──────┐┌──────┐
│Schema││Schema││Schema││Schema│
│API   ││API   ││API   ││API   │
│UI    ││UI    ││UI    ││UI    │
│Test  ││Test  ││Test  ││Test  │
└──────┘└──────┘└──────┘└──────┘
  슬1     슬2     슬3     슬4
```
**효과**: 슬1만 끝나도 1차 출시 가능. 단독 시연.

## 분해 예시 — "주문 취소"

**❌ Bad (3개 horizontal)**:
- Slice 1: OrderState enum + DB 마이그레이션 모두
- Slice 2: 모든 cancel API
- Slice 3: UI 모두

**✅ Good (5개 vertical, dependency 순)**:
1. **[tracer]** PENDING → CANCELED (가장 단순)
   schema 1줄 + API 1개 + UI 버튼 + 테스트
2. PAID → REFUND_REQUESTED (PG 환불 미호출)
3. 환불 비동기 워커 + PG 호출
4. 부분 환불 지원
5. 환불 실패 시 재시도 큐

각 슬라이스는 단독 머지·배포·시연 가능.

## Tracer Bullet 선택 기준

여러 슬라이스 후보 중 **가장 단순한 종단 경로** 1개:

- 가장 적은 의존성
- 가장 적은 새 코드
- 가장 명확한 demoable 결과
- 다른 슬라이스의 dependency 적음

→ 이 1개를 먼저 끝내야 종단 경로가 *작동함*을 증명. 나머지는 같은 패턴 반복.

## AFK vs HITL

| 분류 | 의미 | 우선순위 |
|------|------|----------|
| **AFK** (Away From Keyboard) | 사람 개입 없이 자율 구현·머지 가능 | ✅ 우선 |
| **HITL** (Human-In-The-Loop) | 아키텍처 결정/디자인 리뷰 필요 | ⚠️ 차선 — grill 부족 신호 |

HITL이 많이 나오면 → `/plan` Step 2 (모호함 해소) 부족. 재진입 필요.

## 분리가 무너졌을 때 자가 진단

| 증상 | 위반 | 처방 |
|------|------|------|
| 머지 후 시연 안 됨 | Demoable 위반 | 슬라이스 더 두껍게 (모든 레이어 포함) |
| 슬라이스가 1주일 넘음 | Narrow 위반 | 더 잘게 (1차 출시 가능 형태) |
| HITL 다수 | AFK 위반 | grill 부족 → /plan 재진입 |
| Schema/API/UI가 다른 슬라이스 | Vertical 위반 | 합쳐서 종단 슬라이스로 |

## 인용 — Why Vertical?

> *"Tests written in bulk test imagined behavior, not actual behavior."*

코드 짜기 전 슬라이스를 *모두* 미리 정의 = 상상한 분해. 실제 짜보면 분해가 틀렸다는 걸 알게 됨.
→ Tracer bullet 1개 먼저 통과시키면 *실제로 알게 된 상태에서* 다음 슬라이스 정의 가능.
