// 헤딩 id 기반 섹션 슬라이스 — 단일 페이지 docs 사이트의 모듈별 추출
//
// 빌드: build_section_js() 가
//   - HEADING_ID 줄을 실제 id로 치환하고
//   - @inject:wait-* 마커를 wait-snippets.js 본문으로 치환한다.
//
// 출력 ok:true:  { ok, url, heading_id, heading_text, heading_level, title, lang,
//                  length, excerpt, content_text, extraction_method: 'section', warnings }
// 출력 ok:false: { ok, url, heading_id, error, length:0, excerpt:null, content_text:'',
//                  extraction_method: 'none'|'fallback:section', warnings, ... }

const HEADING_ID = "__HEADING_ID__";
const MIN_SECTION_CHARS = 50;  // 슬라이스 결과의 최소 글자 수

// @inject:wait-ready
// @inject:wait-stable

return await js(`
  (() => {
    const id = ${JSON.stringify(HEADING_ID)};
    const MIN = ${MIN_SECTION_CHARS};
    const url = location.href;
    const title = document.title || '';
    const lang = document.documentElement.lang || null;

    const fail = (extraction_method, error, partial) => ({
      ok: false, url,
      heading_id: id,
      heading_text: partial?.heading_text || '',
      heading_level: partial?.heading_level || 0,
      title, lang,
      length: partial?.length || 0,
      excerpt: null,
      content_text: partial?.content_text || '',
      extraction_method,
      warnings: [],
      error
    });

    const target = document.getElementById(id);
    if (!target || !/^H[1-6]$/.test(target.tagName)) {
      return fail('none', target ? 'element with id is not a heading' : 'heading id not found');
    }

    const level = parseInt(target.tagName.substring(1), 10);
    const heading_text = target.textContent.trim().replace(/\\s+/g, ' ').slice(0, 200);

    const parts = [target.textContent.trim()];
    let cur = target.nextElementSibling;
    while (cur) {
      if (/^H[1-6]$/.test(cur.tagName)) {
        const cl = parseInt(cur.tagName.substring(1), 10);
        if (cl <= level) break;
      }
      const t = (cur.innerText || '').trim();
      if (t) parts.push(t);
      cur = cur.nextElementSibling;
    }

    const text = parts.join('\\n\\n');
    if (text.length < MIN) {
      return fail('fallback:section', 'section too short',
        { heading_text, heading_level: level, length: text.length, content_text: text });
    }

    return {
      ok: true, url,
      heading_id: id,
      heading_text,
      heading_level: level,
      title, lang,
      length: text.length,
      excerpt: text.slice(0, 240).replace(/\\s+/g, ' '),
      content_text: text,
      extraction_method: 'section',
      warnings: []
    };
  })()
`);
