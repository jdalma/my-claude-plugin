#!/usr/bin/env bash
# 단일 URL + 헤딩 id → 섹션 JSON.
# usage: extract-section.sh <url> <heading-id> [out.json]

HERE="$(cd "$(dirname "$0")" && pwd -P)"
source "$HERE/_lib.sh"

USAGE="<url> <heading-id> [out.json]"
URL="${1:?usage: $(basename "$0") $USAGE}"
HID="${2:?usage: $(basename "$0") $USAGE}"
OUT="${3:-}"

require_chromux
ensure_profile

BUILD=$(mktemp -t web-section.XXXXXX.js)
build_section_js "$HID" "$BUILD"
run_oneshot es "$URL" "$BUILD" "$OUT"
