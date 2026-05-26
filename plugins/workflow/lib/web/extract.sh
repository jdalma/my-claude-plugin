#!/usr/bin/env bash
# 단일 URL → 본문 JSON.
# usage: extract.sh <url> [out.json]

HERE="$(cd "$(dirname "$0")" && pwd -P)"
source "$HERE/_lib.sh"

USAGE="<url> [out.json]"
URL="${1:?usage: $(basename "$0") $USAGE}"
OUT="${2:-}"

require_chromux
ensure_profile

BUILD=$(mktemp -t web-extract.XXXXXX.js)
build_extract_js "$BUILD"
run_oneshot we "$URL" "$BUILD" "$OUT"
