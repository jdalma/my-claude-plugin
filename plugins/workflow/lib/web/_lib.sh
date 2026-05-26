# web 워커 공통 헬퍼.  source "$HERE/_lib.sh"
# 외부: chromux, jq, node>=22.

set -euo pipefail

: "${WEB_PROFILE:=web-skill}"       # 일상 Chrome과 격리된 전용 프로필
: "${WEB_MODE:=default}"            # crawl 모드는 Google 등 페이지 세션을 조기 정리하여 부적합
: "${WEB_NAV_WAIT_MS:=15000}"
: "${WEB_CLI_TIMEOUT_MS:=120000}"
: "${WEB_RESULTS_DIR:=$HOME/.chromux/web-skill-results}"

require_chromux() {
  command -v chromux >/dev/null 2>&1 || {
    echo "[web] chromux CLI not found in PATH. https://github.com/team-attention/chromux 참고하여 설치 후 'npm link'." >&2
    return 127
  }
  command -v jq >/dev/null 2>&1 || {
    echo "[web] jq not found. 'brew install jq'." >&2
    return 127
  }
}

ensure_profile() {
  export CHROMUX_PROFILE="$WEB_PROFILE" \
         CHROMUX_MODE="$WEB_MODE" \
         CHROMUX_NAVIGATION_WAIT_MS="$WEB_NAV_WAIT_MS" \
         CHROMUX_CLI_TIMEOUT_MS="$WEB_CLI_TIMEOUT_MS" \
         CHROMUX_OPEN_BACKGROUND=1
  # default 모드는 환경변수 CHROMUX_LAUNCH_MODE를 무시하므로 --headless 플래그 명시
  chromux ps 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$WEB_PROFILE" \
    || chromux launch "$WEB_PROFILE" --headless >/dev/null
}

ts()         { date +%Y%m%d-%H%M%S; }
slug()       { echo "$1" | tr ' /' '_-' | tr -cd '[:alnum:]_-' | cut -c1-60; }
url_encode() { jq -rn --arg q "$1" '$q|@uri'; }

# JS 파일에 @inject:wait-* 마커가 있으면 wait-snippets.js의 본문으로 치환한다.
# - awk로 마커 줄을 만나면 snippet 본문을 출력하고, 마커는 버린다
# - 미치환은 silent fail이 아니라 stderr+exit 2로 알린다
inject_wait_snippets() {  # args: <src_js> <dst_js>
  local src="$1" dst="$2"
  awk -v snip="$WEB_LIB_DIR/wait-snippets.js" '
    function read_snippet(name,   line, capture, out) {
      capture = 0; out = ""
      while ((getline line < snip) > 0) {
        if (line == "// @snippet:" name) { capture = 1; continue }
        if (capture && line == "// @snippet:end") break
        if (capture) out = out line "\n"
      }
      close(snip)
      return out
    }
    /@inject:wait-ready/  { printf "%s", read_snippet("wait-ready");  injected++; next }
    /@inject:wait-stable/ { printf "%s", read_snippet("wait-stable"); injected++; next }
    { print }
    END {
      if (injected == 0) { print "[_lib] inject_wait_snippets: no @inject marker matched" > "/dev/stderr"; exit 2 }
    }
  ' "$src" > "$dst"
}

# extract.js에 Readability.js 절대경로를 박은 빌드 파일 생성.
# 동시에 inject_wait_snippets 적용.
build_extract_js() {  # args: <dst_js>
  local dst="$1"
  local tmp
  tmp=$(mktemp -t web-build.XXXXXX.js)
  sed "s#__READABILITY_PATH__#$WEB_LIB_DIR/Readability.js#" "$WEB_LIB_DIR/extract.js" > "$tmp"
  inject_wait_snippets "$tmp" "$dst"
  rm -f "$tmp"
}

# extract-section.js의 HEADING_ID를 박은 빌드 파일 생성. inject_wait_snippets도 적용.
# 치환은 awk로 안전하게 (정규식 매치 실패 시 exit 2).
build_section_js() {  # args: <heading_id> <dst_js>
  local hid="$1" dst="$2"
  local esc tmp
  esc=$(jq -nc --arg s "$hid" '$s')
  tmp=$(mktemp -t web-build.XXXXXX.js)
  awk -v new="const HEADING_ID = $esc;" '
    /^const HEADING_ID = "__HEADING_ID__";$/ { print new; sub_done=1; next }
    { print }
    END { if (!sub_done) { print "[_lib] build_section_js: HEADING_ID placeholder not found" > "/dev/stderr"; exit 2 } }
  ' "$WEB_LIB_DIR/extract-section.js" > "$tmp" || { rm -f "$tmp"; return 2; }
  inject_wait_snippets "$tmp" "$dst"
  rm -f "$tmp"
}

# 단일 페이지 / 단일 추출 패턴: chromux open → run --file <build> → cleanup.
# usage 메시지와 trap 처리를 일관화.
run_oneshot() {  # args: <session_prefix> <url> <build_js> [<out_file>]
  local prefix="$1" url="$2" build="$3" out="${4:-}"
  local session="$prefix-$$-$RANDOM"
  # shellcheck disable=SC2064
  trap "chromux close '$session' >/dev/null 2>&1 || true; rm -f '$build'" EXIT
  chromux open "$session" "$url" >/dev/null
  if [[ -n "$out" ]]; then
    chromux run "$session" --timeout 60000 --file "$build" > "$out"
    echo "saved: $out" >&2
  else
    chromux run "$session" --timeout 60000 --file "$build"
  fi
}

# 워커 풀: 입력 파일의 각 라인을 워커별 큐로 round-robin 분배 → 병렬 실행 → 결과 머지.
# extract_fn은 (worker_index, item) → JSON 한 줄을 stdout으로 내보내는 함수여야 한다.
# 결과는 워커별 임시 파일에 모은 뒤 cat으로 합쳐 OUT에 쓴다 (동시 append 깨짐 방지).
worker_pool() {  # args: <workers> <input_file> <out_file> <extract_fn> <session_prefix>
  local workers="$1" input="$2" out="$3" fn="$4" session_prefix="$5"
  if (( workers > 8 )); then workers=8; fi
  if (( workers < 1 )); then workers=1; fi

  local tmp w i=0 pids="" failed=""
  tmp=$(mktemp -d)
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN

  for ((w=1; w<=workers; w++)); do : > "$tmp/q.$w"; : > "$tmp/out.$w"; done
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    echo "$line" >> "$tmp/q.$(( i % workers + 1 ))"
    i=$(( i + 1 ))
  done < "$input"

  for ((w=1; w<=workers; w++)); do
    [[ -s "$tmp/q.$w" ]] || continue
    (
      while IFS= read -r item; do
        [[ -z "$item" ]] && continue
        echo "[worker $w] $item" >&2
        if ! "$fn" "$w" "$item" "$tmp/out.$w" "$session_prefix"; then
          touch "$tmp/failed.$w"
        fi
      done < "$tmp/q.$w"
      chromux close "$session_prefix-$w" >/dev/null 2>&1 || true
    ) &
    pids+=" $!"
  done
  for p in $pids; do wait "$p" || failed="y"; done

  cat "$tmp"/out.* > "$out"

  local ok fail
  ok=$(jq -c 'select(.ok==true)' "$out" 2>/dev/null | wc -l | tr -d ' ')
  fail=$(jq -c 'select(.ok!=true)' "$out" 2>/dev/null | wc -l | tr -d ' ')
  echo "[web] extracted: ok=$ok fail=$fail → $out" >&2
  jq -r '.extraction_method // "error"' "$out" 2>/dev/null | sort | uniq -c | sed 's/^/  /' >&2 || true
  [[ -n "$failed" ]] && echo "[web] note: 일부 워커가 실패 종료했습니다 (위 카운트와 별개로 확인)" >&2
  return 0
}

# 호출 스크립트가 사용하는 라이브러리 경로
WEB_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
