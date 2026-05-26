// chromux run 에서 페이지가 로드·안정화될 때까지 기다리는 공용 스니펫.
// 각 추출 JS의 머리에 inject_wait_snippets 헬퍼가 sed로 끼워넣는다.
//
// 사용 마커:
//   // @inject:wait-ready    → readyState 폴링(최대 8초)
//   // @inject:wait-stable   → body.innerText 길이 안정화(최대 15초, 글자 수 변화 3틱 동안 정지하면 종료)
//
// waitLoad()는 광고 많은 페이지에서 timeout이 잦아 안 쓴다.

// @snippet:wait-ready
await js(`new Promise(r => {
  const t0 = Date.now();
  const tick = () => {
    if (document.readyState === 'complete' || document.readyState === 'interactive') return r(true);
    if (Date.now() - t0 > 8000) return r(false);
    setTimeout(tick, 150);
  };
  tick();
})`);
// @snippet:end

// @snippet:wait-stable
await js(`new Promise(r => {
  let last = 0, stable = 0;
  const t0 = Date.now();
  const tick = () => {
    const len = (document.body && document.body.innerText.length) || 0;
    if (len > 400 && len === last) {
      if (++stable >= 3) return r(true);
    } else {
      stable = 0;
      last = len;
    }
    if (Date.now() - t0 > 15000) return r(false);
    setTimeout(tick, 300);
  };
  tick();
})`);
// @snippet:end
