#!/usr/bin/env bash
# Google 검색 → 상위 N개(기본 30, 최대 30) 결과 JSON 배열.
# usage: search.sh <query> [N=30]

HERE="$(cd "$(dirname "$0")" && pwd -P)"
source "$HERE/_lib.sh"

USAGE="<query> [N=30]"
QUERY="${1:?usage: $(basename "$0") $USAGE}"
N="${2:-30}"
(( N > 30 )) && N=30
(( N < 1 )) && N=1

require_chromux
ensure_profile

ENCQ=$(url_encode "$QUERY")
URL="https://www.google.com/search?q=${ENCQ}&hl=ko&num=$(( N + 5 ))"  # 광고 흡수용 여유

SESSION="ws-$$-$RANDOM"
trap "chromux close '$SESSION' >/dev/null 2>&1 || true" EXIT
chromux open "$SESSION" "$URL" >/dev/null
chromux run "$SESSION" --timeout 30000 --file "$HERE/search.js" | jq --argjson n "$N" '.[0:$n]'
