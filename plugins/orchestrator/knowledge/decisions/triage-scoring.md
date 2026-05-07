# Triage Scoring — Metis의 4차원 모호성 점수

## 결정

Phase 0 Triage에서 Metis 에이전트는 사용자 요청을 **3차원 가중 점수(0~1 스케일)**로 평가하여 Question Debt 후보를 분류한다.

| 차원 | 의미 | 가중치 | 점수 0이 의미하는 것 | 점수 1이 의미하는 것 |
|---|---|---|---|---|
| Goal | 목표가 측정 가능한가 | 0.40 | 목표가 검증 가능한 단일 결과로 정의됨 | 목표가 추상적·다의적 |
| Constraints | 제약조건이 명시되었는가 | 0.30 | 모든 제약(시간/품질/외부 의존성)이 명시 | 제약이 거의 미정 |
| Criteria | 합격 기준이 검증 가능한가 | 0.30 | acceptance criteria가 객관적으로 검증 가능 | 합격 기준 부재 또는 주관적 |

가중합 = `0.4·Goal + 0.3·Constraints + 0.3·Criteria` ∈ [0, 1]

### 분류 임계값

| 가중합 | 분류 | confidence 기록 |
|---|---|---|
| < 0.35 | soft | confidence ≥ 0.7 |
| 0.35 ~ 0.65 | soft (낮은 신뢰도) | confidence < 0.7 |
| > 0.65 | hard | (해당 없음 — 가정 채택 안 함) |

**연쇄 영향 예외**: 점수와 무관하게 "다른 태스크에 연쇄 영향"이 있으면 hard로 자동 승격.

## 근거

- OMC `deep-interview` 스킬의 4차원(Goal/Constraints/Criteria/Assumptions) 체계를 차용하되, "Assumptions" 차원은 다른 3개와 의미가 중복되어 제거
- 0~1 스케일을 채택한 이유: 가중치 합이 1이므로 가중합도 1 이내. 임계값 비교가 직관적
- 임계값 0.35 / 0.65는 보수적으로 설정. 의심스러우면 hard로 분류

## 적용 범위

- Metis 에이전트의 triage.json 생성 시
- 다른 에이전트가 실행 중 신규 debt를 발견할 때도 동일 점수 체계 사용
- 점수 산출 근거는 `classifier_rationale` 필드에 명시 ("Goal=0.3, Constraints=0.5, Criteria=0.2 → 가중합 0.34. soft 임계 0.35 미만이므로 soft.")

## 관련 에이전트

- metis (1차 분류 주체)
- planner, backenddev, appdev, designer, critic, verifier (실행 중 신규 debt 분류 시 참조)

## 참고

- 설계 문서: `docs/design/orchestrator-v2.md` §3.3
- 외부 차용: OMC `oh-my-claudecode/skills/deep-interview/SKILL.md`
