#!/usr/bin/env bash
# 여러 URL을 워커 풀로 본문 추출 → JSONL.
# usage: extract-urls.sh <urls-file> <out-jsonl> [workers=3] [label]

HERE="$(cd "$(dirname "$0")" && pwd -P)"
source "$HERE/_lib.sh"

USAGE="<urls-file> <out-jsonl> [workers=3] [label]"
URLS_FILE="${1:?usage: $(basename "$0") $USAGE}"
OUT="${2:?usage: $(basename "$0") $USAGE}"
WORKERS="${3:-3}"
LABEL="${4:-batch}"

require_chromux
ensure_profile

# 빌드는 한 번만. 워커들이 같은 BUILD 파일을 공유 (read-only).
BUILD=$(mktemp -t web-extract.XXXXXX.js)
trap 'rm -f "$BUILD"' EXIT
build_extract_js "$BUILD"

extract_url() {  # args: <worker_idx> <url> <out_file> <session_prefix>
  local w="$1" url="$2" out="$3" prefix="$4"
  local session="$prefix-$w" tmp
  if ! chromux open "$session" "$url" >/dev/null 2>&1; then
    jq -cn --arg url "$url" --argjson w "$w" \
      '{ok:false, url:$url, worker:$w, error:"open failed"}' >> "$out"
    return 1
  fi
  tmp=$(mktemp)
  if chromux run "$session" --timeout 60000 --file "$BUILD" > "$tmp" 2>/dev/null; then
    jq -c --argjson w "$w" '. + {worker:$w}' "$tmp" >> "$out"
    rm -f "$tmp"
    return 0
  fi
  jq -cn --arg url "$url" --argjson w "$w" \
    '{ok:false, url:$url, worker:$w, error:"extract failed"}' >> "$out"
  rm -f "$tmp"
  return 1
}
export -f extract_url
export BUILD

worker_pool "$WORKERS" "$URLS_FILE" "$OUT" extract_url ww
