---
name: web-extract
description: 단일 URL 본문을 chromux로 추출하고 메인엔 경로+메타+종합만 반환 (web-researcher 위임). chromux 필요.
argument-hint: <url> [의도]
---

# /web-extract — 단일 URL 본문 추출 (에이전트 위임)

## 인자

`$ARGUMENTS` 첫 토큰은 URL, 나머지는 사용자의 의도/추출 후 무엇을 원하는지(선택).

URL이 비어 있으면 사용자에게 물어본다.

## 실행 규칙 (메인 에이전트가 따를 것)

이 커맨드가 호출되면 **반드시 `web-researcher` 서브에이전트에 위임**한다. 본문을 직접 받지 않는다.

```
Agent(
  subagent_type="web-researcher",
  description="단일 URL 본문 추출",
  prompt="""
사용자 의도: <$ARGUMENTS의 의도 부분 또는 '본문 가져오기'>
처리할 URL: <$ARGUMENTS의 URL>

extract.sh를 사용해 article.json으로 저장하고, 메타 표 + 한 단락 종합만 반환하라.
content_text를 메시지에 옮기지 말 것.
"""
)
```

## 메인 에이전트가 반환받는 것

- 결과 디렉터리 절대 경로 (`~/.chromux/web-skill-results/<ts>-<slug>/`)
- 메타 표 (제목, URL, 추출방법, 글자수, OK)
- 2~4문장 종합

## 메인 에이전트가 답할 때

1. 받은 종합을 그대로 또는 사용자 의도에 맞게 정리해 답한다.
2. 사용자가 본문 인용·발췌·요약 깊이를 요구하면 그때 `Read`로 `article.json`을 부분 읽기.
3. 출처 URL은 반드시 표기.
4. `ok:false` 또는 `extraction_method:none`이면 "읽지 못함"이라고 정직하게 보고. 내용 만들지 말 것.

## 실패 시

- 에이전트가 chromux/jq 미설치를 보고하면 사용자에게 설치 안내 그대로 전달
- 봇 차단/캡차 시 헤디드 로그인 권장 안내
