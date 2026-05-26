---
name: web-search
description: Google 검색 상위 N개를 보여주고 사용자 선택 URL은 web-researcher에 위임해 본문 추출. chromux 필요.
argument-hint: <쿼리> [N=30]
---

# /web-search — 검색 → 사용자 선택 → 본문 일괄 추출 (2단계, 추출은 에이전트 위임)

이 커맨드의 두 단계는 **컨텍스트 비용이 다르다.** 검색 결과 목록은 작아서 메인이 직접 받아도 되고 사용자 선택을 받아야 하니까 메인에 있어야 한다. 추출 본문은 크니까 web-researcher에 위임한다.

## 인자

`$ARGUMENTS`:
- 첫 토큰: 검색 쿼리 (따옴표로 감싸는 게 안전)
- 둘째 토큰(선택): N (1~30, 기본 30)

비어 있으면 사용자에게 쿼리를 물어본다.

## Step 1: 메인이 검색 직접 실행

```bash
${CLAUDE_PLUGIN_ROOT}/lib/web/search.sh "<쿼리>" <N>
```

stdout으로 JSON 배열: `[{title, href, snippet}, ...]`

메인이 받아서 사용자에게 **1-indexed 번호 매긴 목록**으로 표시:

```
1. <title>
   <href>
   <snippet 1줄>

2. ...
```

질문: *"본문을 가져올 번호를 알려주세요. 예: 1,3,5 또는 1-5 또는 all"*

## Step 2: 사용자 선택 수신

사용자 입력 → 0-indexed 변환:
- `1,3,5` → `[0, 2, 4]`
- `1-5` → `[0, 1, 2, 3, 4]`
- `all` → 전체
- 범위 벗어난 번호는 사용자에게 확인 (임의 보정 X)

## Step 3: 추출은 web-researcher에 위임

```
Agent(
  subagent_type="web-researcher",
  description="검색 결과 N건 본문 추출",
  prompt="""
사용자 의도: <원래 쿼리 또는 사용자가 추가로 말한 의도>
처리할 URL:
<선택된 URL 목록>

extract-urls.sh로 articles.jsonl로 저장하고, 메타 표 + 한 단락 종합만 반환.
워커 수는 3 (URL이 1~2개면 그 수에 맞춤, 최대 8).
"""
)
```

## Step 4: 메인이 받는 것

- 결과 디렉터리 절대 경로
- URL별 메타 표
- 2~4문장 종합

## Step 5: 메인 응답

1. 받은 종합을 사용자 의도에 맞게 정리해 답한다.
2. 본문이 필요하면 `Read`로 `articles.jsonl`을 부분 읽기. 한 번에 5개 다 읽지 말 것.
3. 출처 URL 표기. `ok:false` URL은 "읽지 못함"이라고 표시.
4. 광고/캡차로 의심되는 결과는 사용자에게 보고.

## 실패 시

- `search.sh`가 빈 배열 → Google 캡차 가능성. 헤디드 로그인 1회 권장
- 에이전트가 chromux/jq 미설치 보고 → 사용자에게 그대로 전달
- 일부 URL `ok:false` → 다른 후보 선택 제안 가능
