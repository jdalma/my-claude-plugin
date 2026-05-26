// 단일 페이지의 헤딩 트리(목차) 추출 — Antora/MkDocs/Hugo/Docusaurus 류 docs 사이트
//
// 출력: { ok, url, title, lang, headings: [{level, depth, id, text, hasContent}] }
// - id 없는 헤딩은 스킵 (앵커가 없으면 섹션 슬라이스 불가)
// - hasContent: 다음 동위 헤딩까지의 텍스트가 200자 이상인지

// @inject:wait-ready
// @inject:wait-stable

return await js(`
  (() => {
    const url = location.href;
    const title = document.title || '';
    const lang = document.documentElement.lang || null;

    // 본문 영역 안의 h1~h3만 (사이드바·푸터 헤딩 제외, h4 이하는 너무 잘게 쪼개짐)
    const root = document.querySelector('main, article, [role="main"]') || document.body;
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));

    const out = [];
    for (const h of headings) {
      if (!root.contains(h)) continue;
      const id = h.id || h.querySelector('a[id]')?.id || '';
      if (!id) continue;

      const level = parseInt(h.tagName.substring(1), 10);
      const text = h.textContent.trim().replace(/\\s+/g, ' ').slice(0, 200);

      // 다음 동위(또는 상위) 헤딩 직전까지의 텍스트 길이 측정
      let contentLen = 0;
      let node = h.nextElementSibling;
      while (node) {
        if (/^H[1-6]$/.test(node.tagName)) {
          const nl = parseInt(node.tagName.substring(1), 10);
          if (nl <= level) break;
        }
        contentLen += (node.innerText || '').length;
        if (contentLen > 200) break;
        node = node.nextElementSibling;
      }

      out.push({ level, depth: level - 1, id, text, hasContent: contentLen > 200 });
    }

    return { ok: true, url, title, lang, headings: out };
  })()
`);
