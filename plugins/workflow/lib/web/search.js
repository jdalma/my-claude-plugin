// Google 검색 결과에서 상위 결과 추출
// 호출자가 num 파라미터로 페이지 사이즈를 조정하고, 결과는 후처리에서 자른다.

await js(`new Promise(r => {
  const t0 = Date.now();
  const tick = () => {
    const n = document.querySelectorAll('a h3').length;
    if (n >= 10) return r(true);
    if (Date.now() - t0 > 10000) return r(false);
    setTimeout(tick, 200);
  };
  tick();
})`);

return await js(`
  (() => {
    const items = [];
    const seen = new Set();
    document.querySelectorAll('a h3').forEach(h3 => {
      const a = h3.closest('a');
      if (!a || !a.href || !/^https?:/.test(a.href)) return;
      if (a.href.startsWith('https://www.google.')) return;
      if (seen.has(a.href)) return;
      seen.add(a.href);
      const container = a.closest('div[data-hveid], div.g, div.MjjYud') || a.parentElement;
      const snipEl = container?.querySelector('[data-sncf], .VwiC3b, .lEBKkf, [data-content-feature]');
      items.push({
        title: h3.innerText.trim(),
        href: a.href,
        snippet: (snipEl?.innerText || '').trim().slice(0, 300)
      });
    });
    return items;
  })()
`);
