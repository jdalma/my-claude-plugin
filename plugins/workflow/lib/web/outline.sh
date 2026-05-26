#!/usr/bin/env bash
# 단일 페이지의 헤딩 트리(목차) JSON.
# usage: outline.sh <url> [out.json]

HERE="$(cd "$(dirname "$0")" && pwd -P)"
source "$HERE/_lib.sh"

USAGE="<url> [out.json]"
URL="${1:?usage: $(basename "$0") $USAGE}"
OUT="${2:-}"

require_chromux
ensure_profile

BUILD=$(mktemp -t web-outline.XXXXXX.js)
inject_wait_snippets "$HERE/outline.js" "$BUILD"
run_oneshot ol "$URL" "$BUILD" "$OUT"
