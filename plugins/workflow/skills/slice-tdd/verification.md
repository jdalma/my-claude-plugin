# Verification Gate Function

> 흡수 출처: `superpowers:verification-before-completion`
> 적용: slice-tdd 스킬 Step 5 (완료 주장 전)

## Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

이번 메시지에서 검증 명령을 *직접 실행하지 않았다면*, 통과 주장 불가.

## Core Principle

> 검증 없는 완료 주장 = 효율이 아니라 거짓말.

## Gate Function — 5단계

```
주장 직전:

1. IDENTIFY: 이 주장을 증명하는 명령은?
2. RUN:      전체 명령 실행 (fresh, complete — 부분 X)
3. READ:     출력 전체 + exit code + 실패 카운트 확인
4. VERIFY:   출력이 주장을 뒷받침하는가?
   - NO  → 실제 상태를 증거와 함께 보고
   - YES → 주장을 증거와 함께 보고
5. ONLY THEN: 주장

어느 단계 생략 = 거짓말, 검증 아님.
```

## Common Failures Table

| 주장 | 필요 증거 | 불충분 |
|------|---------|--------|
| Tests pass | 테스트 명령 출력: 0 failures | 이전 실행, "통과할 것" |
| Linter clean | linter 출력: 0 errors | 부분 체크, 외삽 |
| Build succeeds | build 명령: exit 0 | linter 통과, "로그 좋아 보임" |
| Bug fixed | 원래 증상 테스트: 통과 | 코드 변경, "고쳤다고 가정" |
| Regression test works | RED→GREEN 사이클 검증 | 테스트 한 번 통과 |
| Agent completed | VCS diff 변경 확인 | agent "성공" 보고 |
| Requirements met | 줄별 체크리스트 | 테스트 통과 |

## Red Flags — 즉시 STOP

다음 표현 사용 시:
- "should", "probably", "seems to", "likely"
- 검증 전 만족 표현 ("Great!", "Perfect!", "Done!", "완료!")
- 검증 없이 commit/push/PR
- agent 성공 보고 신뢰
- 부분 검증 의존
- "이번 한 번만" 사고
- 피곤해서 그냥 끝내고 싶음

→ 모두 거짓 주장 직전 신호.

## TDD Step 5와의 통합

매 슬라이스 완료 시:

1. 모든 behavior 테스트 실행 → 0 failures 확인
2. 회귀 테스트 (다른 영역 깨짐) 확인
3. 빌드/lint 실행 → exit 0
4. (선택) `omc:verify` Skill 호출로 외부 검증 게이트 추가
5. `features/<feature-name>/tdd-state/slice-N.md`의 *Cycle log*에 검증 timestamp 기록

이후에만 슬라이스 *완료* 주장 가능.

## Verification ≠ TDD GREEN

- TDD GREEN = behavior 1개 통과
- Verification = 슬라이스 *전체* 통과 + 회귀 무결성

GREEN 5번 봤다고 슬라이스 완료 X. 명시적 verification gate 1회 더.
