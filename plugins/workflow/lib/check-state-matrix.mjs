#!/usr/bin/env node
/**
 * check-state-matrix.js — 4-에셋 워크플로우 상태 책임 매트릭스 동일성 검사.
 *
 * plan / slice-tdd / handoff / takeover 네 스킬은 모두 동일한
 * "상태 갱신 책임 매트릭스" 표(누가 task-index.md / tdd-state 를 생성·갱신·읽기만
 * 하는가)를 본문에 중복 보유한다. 표가 4곳에 손으로 복사돼 있어 한 곳만 고치면
 * 나머지가 drift 한다 — 실제로 takeover는 `slice-tdd`를 폐기된 옛 이름 `tdd`로
 * 적고 있었다.
 *
 * 이 스크립트는 그 불변식("4곳의 매트릭스는 의미가 동일하다")을 문서가 아니라
 * 테스트로 강제한다. 각 스킬이 자기 역할을 **볼드**로 강조하는 것은 의도된
 * 차이이므로 볼드 마커만 무시하고, 나머지 셀 텍스트는 정확히 일치해야 한다.
 *
 * 사용: node plugins/workflow/lib/check-state-matrix.js
 * exit 0 = 모든 매트릭스 일치, exit 1 = drift 발견 (빌드게이트로 사용 가능).
 *
 * 의존성 0 (Node 표준 라이브러리만). workflow 플러그인은 markdown 자산이라
 * 별도 test 러너가 없으므로 독립 실행 스크립트로 둔다.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const ASSETS = ['plan', 'slice-tdd', 'handoff', 'takeover'];

/**
 * SKILL.md 본문에서 매트릭스 표를 추출한다. 표는 `| 파일 | 생성 | 갱신 | 읽기만 |`
 * 헤더로 시작하고, 구분선(`|---|`) 다음의 데이터 행들로 이뤄진다. 파일에 표가
 * 여러 번 나오면 첫 번째만 — 4곳 모두 본문 끝의 "상태 갱신 책임 매트릭스"
 * 섹션에 한 번씩 둔다.
 */
function extractMatrix(skillName) {
    const path = join(SKILLS_DIR, skillName, 'SKILL.md');
    const lines = readFileSync(path, 'utf-8').split('\n');
    const headerIdx = lines.findIndex((l) => /^\|\s*파일\s*\|/.test(l));
    if (headerIdx === -1) {
        throw new Error(`[${skillName}] 매트릭스 표 헤더(| 파일 | ...)를 찾지 못함: ${path}`);
    }
    const rows = [];
    // 헤더 다음 줄은 구분선(|---|). 그 다음부터 표가 끝날 때까지 데이터 행 수집.
    for (let i = headerIdx + 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trimStart().startsWith('|')) break; // 표 종료
        rows.push(line);
    }
    if (rows.length === 0) {
        throw new Error(`[${skillName}] 매트릭스 표에 데이터 행이 없음: ${path}`);
    }
    return rows.map(splitCells);
}

/** 마크다운 표 한 줄을 셀 배열로 분해하고 각 셀을 정규화한다. */
function splitCells(row) {
    return row
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(normalizeCell);
}

/**
 * 셀 정규화: 볼드 마커(`**`)만 제거하고 공백을 접는다. 각 스킬이 자기 역할을
 * 볼드 처리하는 것은 의도된 차이이므로 무시한다. 그 외 텍스트(특히 `tdd` vs
 * `slice-tdd` 같은 이름)는 보존해 drift 로 잡는다.
 */
function normalizeCell(cell) {
    return cell.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

function main() {
    const matrices = {};
    for (const asset of ASSETS) {
        matrices[asset] = extractMatrix(asset);
    }

    // plan 을 canonical 기준으로 삼아 나머지를 대조.
    const [canonicalName, ...rest] = ASSETS;
    const canonical = matrices[canonicalName];
    const drifts = [];

    for (const asset of rest) {
        const m = matrices[asset];
        if (m.length !== canonical.length) {
            drifts.push(
                `[${asset}] 행 개수 불일치: ${m.length} (기준 ${canonicalName}: ${canonical.length})`
            );
            continue;
        }
        for (let r = 0; r < canonical.length; r++) {
            const a = canonical[r];
            const b = m[r];
            if (b.length !== a.length) {
                drifts.push(`[${asset}] 행 ${r + 1} 셀 개수 불일치: ${b.length} (기준 ${a.length})`);
                continue;
            }
            for (let c = 0; c < a.length; c++) {
                if (a[c] !== b[c]) {
                    drifts.push(
                        `[${asset}] 행 ${r + 1} 열 ${c + 1} drift:\n` +
                        `    기준(${canonicalName}): "${a[c]}"\n` +
                        `    실제(${asset}):   "${b[c]}"`
                    );
                }
            }
        }
    }

    if (drifts.length === 0) {
        console.log(`✅ 4-에셋 매트릭스 일치 (${ASSETS.join(' / ')}) — 볼드 강조 제외 동일.`);
        process.exit(0);
    }

    console.error(`❌ 4-에셋 매트릭스 drift ${drifts.length}건 발견:\n`);
    for (const d of drifts) console.error('  ' + d + '\n');
    console.error(
        '→ 매트릭스는 plan/slice-tdd/handoff/takeover 4곳에 동일해야 한다 ' +
        '(자기 역할 볼드 강조만 허용). 한 곳을 고쳤으면 나머지도 맞춰라.'
    );
    process.exit(1);
}

main();
