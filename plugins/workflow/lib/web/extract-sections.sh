#!/usr/bin/env bash
# 같은 URL의 여러 헤딩 섹션을 워커 풀로 일괄 추출 → JSONL.
# usage: extract-sections.sh <url> <ids-file> <out-jsonl> [workers=3]

HERE="$(cd "$(dirname "$0")" && pwd -P)"
source "$HERE/_lib.sh"

USAGE="<url> <ids-file> <out-jsonl> [workers=3]"
URL="${1:?usage: $(basename "$0") $USAGE}"
IDS_FILE="${2:?usage: $(basename "$0") $USAGE}"
OUT="${3:?usage: $(basename "$0") $USAGE}"
WORKERS="${4:-3}"

require_chromux
ensure_profile

# 같은 URL이라 워커 세션을 재사용 (extract_one이 첫 호출에서만 open)
extract_one() {  # args: <worker_idx> <heading_id> <out_file> <session_prefix>
  local w="$1" hid="$2" out="$3" prefix="$4"
  local session="$prefix-$w"

  # 워커별 1회만 open (멱등하게 close→open 보다 빠름)
  if ! chromux list 2>/dev/null | jq -e --arg s "$session" '.[$s]' >/dev/null 2>&1; then
    if ! chromux open "$session" "$URL" >/dev/null 2>&1; then
      jq -cn --arg url "$URL" --arg hid "$hid" --argjson w "$w" \
        '{ok:false, url:$url, heading_id:$hid, worker:$w, error:"open failed"}' >> "$out"
      return 1
    fi
  fi

  local build tmp
  build=$(mktemp -t web-section.XXXXXX.js)
  if ! build_section_js "$hid" "$build"; then
    rm -f "$build"
    jq -cn --arg url "$URL" --arg hid "$hid" --argjson w "$w" \
      '{ok:false, url:$url, heading_id:$hid, worker:$w, error:"build failed"}' >> "$out"
    return 1
  fi

  tmp=$(mktemp)
  if chromux run "$session" --timeout 60000 --file "$build" > "$tmp" 2>/dev/null; then
    jq -c --argjson w "$w" '. + {worker:$w}' "$tmp" >> "$out"
    rm -f "$tmp" "$build"
    return 0
  fi
  jq -cn --arg url "$URL" --arg hid "$hid" --argjson w "$w" \
    '{ok:false, url:$url, heading_id:$hid, worker:$w, error:"extract failed"}' >> "$out"
  rm -f "$tmp" "$build"
  return 1
}
export -f extract_one build_section_js inject_wait_snippets
export URL WEB_LIB_DIR

worker_pool "$WORKERS" "$IDS_FILE" "$OUT" extract_one ss
