// 본문 추출 — 옵션 D
//   1차: Mozilla Readability 주입 → article.textContent
//   폴백: main → article → [role=main] → body innerText
//
// 빌드: build_extract_js() 가
//   - __READABILITY_PATH__ 자리에 절대 경로를 박고
//   - @inject:wait-* 마커를 wait-snippets.js 본문으로 치환한다.

const READABILITY_PATH = "__READABILITY_PATH__";
const MIN_BODY_CHARS = 300;  // Readability 본문/폴백 섹션의 최소 글자 수

const fs = await import('node:fs/promises');
const readabilitySrc = await fs.readFile(READABILITY_PATH, 'utf8');

// @inject:wait-ready

// Readability 주입
await js(`(() => {
  if (window.__readabilityReady) return;
  const s = document.createElement('script');
  s.textContent = ${JSON.stringify(readabilitySrc)};
  document.head.appendChild(s);
  window.__readabilityReady = !!window.Readability;
})()`);

// @inject:wait-stable

return await js(`
  (() => {
    const MIN = ${MIN_BODY_CHARS};
    const warnings = [];
    const url = location.href;
    const title = document.title || '';
    const lang = document.documentElement.lang || null;
    const published =
      document.querySelector('meta[property="article:published_time"]')?.content ||
      document.querySelector('meta[name="article:published_time"]')?.content ||
      document.querySelector('meta[itemprop="datePublished"]')?.content ||
      document.querySelector('time[datetime]')?.getAttribute('datetime') ||
      null;

    // ok:false 가지에서도 같은 키 셋을 유지해 호출자(web-researcher)가 일률 접근 가능하게 함
    const baseFail = (extraction_method, extra_warnings) => ({
      ok: false, url, title,
      byline: null, site_name: null, lang, published,
      length: 0, excerpt: null, content_text: '',
      extraction_method,
      warnings: warnings.concat(extra_warnings || [])
    });

    // 1차: Readability — length는 article.length(HTML 길이)가 아닌 textContent 길이로 통일
    if (window.Readability) {
      try {
        const docClone = document.cloneNode(true);
        const article = new Readability(docClone).parse();
        const text = article && article.textContent ? article.textContent : '';
        if (text.length >= MIN) {
          return {
            ok: true, url,
            title: article.title || title,
            byline: article.byline || null,
            site_name: article.siteName || null,
            lang: article.lang || lang,
            published,
            length: text.length,
            excerpt: article.excerpt || text.slice(0, 240),
            content_text: text,
            extraction_method: 'readability',
            warnings
          };
        }
        warnings.push('readability: parsed but content too short or null');
      } catch (e) {
        warnings.push('readability: threw ' + (e && e.message ? e.message : String(e)));
      }
    } else {
      warnings.push('readability: not loaded');
    }

    // 폴백 체인
    const tryEl = (sel, method) => {
      const el = document.querySelector(sel);
      const text = (el && el.innerText ? el.innerText.trim() : '');
      if (text.length >= MIN) {
        return {
          ok: true, url, title,
          byline: null, site_name: null, lang, published,
          length: text.length,
          excerpt: text.slice(0, 240),
          content_text: text,
          extraction_method: method,
          warnings
        };
      }
      return null;
    };

    return (
      tryEl('main',          'fallback:main') ||
      tryEl('article',       'fallback:article') ||
      tryEl('[role="main"]', 'fallback:role-main') ||
      (() => {
        const text = (document.body && document.body.innerText) ? document.body.innerText.trim() : '';
        if (text.length === 0) return baseFail('none', ['body: empty innerText']);
        return {
          ok: true, url, title,
          byline: null, site_name: null, lang, published,
          length: text.length,
          excerpt: text.slice(0, 240),
          content_text: text,
          extraction_method: 'fallback:body',
          warnings
        };
      })()
    );
  })()
`);
