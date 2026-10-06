/**
 * illustrations.js — 鞋款線條插畫（自繪 SVG，不使用品牌圖片）
 *
 * 每個鞋款在 models.json 的 art 欄位設定：
 *   kind   外型：sneaker / platform / runner / loafer / maryjane / oxford / derby /
 *                 boot-service / boot-chelsea / boot-hiker / boot-chukka
 *   upper  鞋面顏色、sole 鞋底顏色、accent 點綴色（可省略）
 *   mark   特徵細節（可省略）：stamp 金色編號 / retro 拼接 / heeltab 後跟片 / tassel 流蘇 / splittoe 中縫
 * 若 models.json 的 image 欄位有圖片路徑，畫面會改用圖片。
 */

let uid = 0;

/** 判斷顏色深淺，決定細節線條用深色或淺色 */
function isDark(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
}

/** 沿著一條線排列鞋帶孔 */
function eyelets(x1, y1, x2, y2, n, line) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    s += `<path d="M${x - 1} ${y - 0.5} l7 -4" stroke="${line}" stroke-width="1.6" stroke-linecap="round"/>`;
    s += `<circle cx="${x}" cy="${y}" r="1.2" fill="${line}"/>`;
  }
  return s;
}

// 鞋底樣式
const SOLES = {
  cup: 'M16 72 H184 Q191 72 191 78 Q191 86 183 86 H22 Q16 86 16 80 Z',
  platform: 'M16 64 H184 Q191 64 191 72 Q191 86 183 86 H22 Q16 86 16 80 Z',
  runner: 'M14 70 H172 Q191 70 192 78 Q192 86 184 86 H22 Q14 86 14 79 Z',
  dress: 'M19 74 H186 Q191 74 191 78 Q191 82 186 82 H58 Q53 82 53 86 H20 Z',
  boot: 'M17 74 H187 Q192 74 192 79 Q192 84 186 84 H56 Q52 84 52 87 H18 Z',
  lug: 'M16 74 H187 Q193 74 193 80 Q193 88 186 88 H20 Q16 88 16 84 Z',
  crepe: 'M18 74 H186 Q191 74 191 79 Q191 85 185 85 H22 Q18 85 18 81 Z',
  maryjane: 'M27 74 H176 Q182 74 182 78 Q182 81 176 81 H50 V87 H31 V79 Z',
};

/** 各外型的鞋面輪廓與細節。line = 輪廓線色、detail = 縫線色 */
function shape(kind, c) {
  const { line, detail, accent } = c;
  const stitch = (d) => `<path d="${d}" fill="none" stroke="${detail}" stroke-width="0.9" stroke-dasharray="2.2 2"/>`;
  const seam = (d) => `<path d="${d}" fill="none" stroke="${detail}" stroke-width="1.1"/>`;

  switch (kind) {
    case 'sneaker':
    case 'platform': {
      const up = kind === 'platform' ? -8 : 0;
      const g = (inner) => (up ? `<g transform="translate(0 ${up})">${inner}</g>` : inner);
      let marks = '';
      if (c.mark === 'stamp') marks += `<g fill="${accent}">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${30 + i * 2.6}" y="62" width="1.6" height="4.2" rx="0.4"/>`).join('')}</g>`;
      if (c.mark === 'heeltab') marks += `<path d="M20 50 Q27 48 31 53 L32 66 L20 68 Z" fill="${accent}" stroke="${line}" stroke-width="1"/>`;
      if (c.mark === 'retro') marks += `<path d="M126 55 Q148 70 187 71 L187 72 Q150 72 118 58 Z M20 50 Q34 52 40 72 L20 72 Z" fill="#d9d4cc" stroke="${line}" stroke-width="1"/>`;
      return {
        sole: kind === 'platform' ? SOLES.platform : SOLES.cup,
        soleDetail: kind === 'platform' ? stitch('M20 69 H186') + seam('M18 77 H189') : stitch('M20 77 H186'),
        upper: g('<path d="M21 72 Q17 62 20 50 Q21 43 28 43 Q43 44 54 52 L66 42 Q68 33 76 34 Q81 35 79 40 L128 55 Q160 58 176 62 Q190 66 188 72 Z"/>'),
        details: g(seam('M20 50 Q31 51 35 58 L37 72') + seam('M128 55 Q133 63 141 72') + stitch('M23 68 H40') + eyelets(80, 41, 124, 54, 5, line) + marks),
      };
    }
    case 'runner':
      return {
        sole: SOLES.runner,
        soleDetail: seam('M16 81 H190') + `<path d="M20 75 Q60 72 100 76 T186 75" fill="none" stroke="${detail}" stroke-width="1"/>`,
        upper: '<path d="M18 70 L19 48 Q20 41 27 41 Q42 42 52 50 L64 40 Q66 31 74 32 Q79 33 77 38 L126 52 Q160 58 178 64 Q190 68 188 70 Z"/>',
        details:
          `<path d="M120 52 Q140 66 188 68 L188 70 L132 70 Q122 60 120 52 Z M19 48 Q34 50 42 70 L19 70 Z" fill="${accent}" opacity="0.55"/>` +
          `<path d="M48 66 Q84 49 118 53" fill="none" stroke="${accent}" stroke-width="3.2" stroke-linecap="round"/>` +
          eyelets(78, 39, 122, 51, 5, line),
      };
    case 'loafer': {
      let extra = '';
      if (c.mark === 'tassel') extra = `<path d="M96 57 q2 6 -1 12 M99 57 q3 6 1 12" stroke="${line}" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="97" cy="57" r="2" fill="${line}"/>`;
      return {
        sole: SOLES.dress,
        soleDetail: stitch('M24 76.5 H187') + seam('M20 79 H53') + seam('M20 82.5 H53'),
        upper: '<path d="M24 74 Q19 66 21 58 Q22 51 29 51 Q50 53 72 57 Q88 54 106 54 Q146 56 172 61 Q191 65 190 74 Z"/>',
        details:
          seam('M22 60 Q34 60 38 74') +
          seam('M88 57 Q118 52 150 60 Q170 65 185 71') +
          stitch('M90 60 Q118 55 149 63 Q168 68 182 73') +
          (c.mark === 'tassel'
            ? extra
            : `<path d="M76 58 Q92 56 106 56 L110 67 Q94 69 80 70 Z" fill="rgba(0,0,0,0.08)" stroke="${line}" stroke-width="1.1"/><ellipse cx="93" cy="61.5" rx="6" ry="1.5" fill="${line}"/>`),
      };
    }
    case 'maryjane':
      return {
        sole: SOLES.maryjane,
        soleDetail: seam('M31 82 H50'),
        upper: '<path d="M32 74 Q26 66 29 60 Q30 54 36 54 Q58 58 86 59 Q126 57 154 60 Q180 63 178 74 Z"/>',
        details:
          seam('M30 62 Q40 62 44 74') +
          `<path d="M68 58 Q82 40 100 57" fill="none" stroke="${line}" stroke-width="6" stroke-linecap="round"/>` +
          `<path d="M68 58 Q82 40 100 57" fill="none" stroke="${c.upper}" stroke-width="3.6" stroke-linecap="round"/>` +
          `<rect x="64" y="53" width="8" height="7" rx="1.2" fill="${c.upper}" stroke="${accent}" stroke-width="1.6"/>`,
      };
    case 'oxford':
    case 'derby': {
      let toe = '';
      if (kind === 'oxford') toe = seam('M150 61 Q158 66 158 74') + stitch('M147 61.5 Q155 66.5 155 74');
      if (c.mark === 'splittoe') toe = seam('M112 56 Q150 60 186 70');
      const facing =
        kind === 'oxford'
          ? seam('M86 50 Q78 62 84 74') + eyelets(64, 53, 80, 49, 4, line)
          : seam('M58 55 Q70 52 82 49 Q88 60 76 74') + eyelets(62, 54, 80, 50, 4, line);
      return {
        sole: SOLES.dress,
        soleDetail: stitch('M24 76.5 H187') + seam('M20 79 H53') + seam('M20 82.5 H53'),
        upper: '<path d="M24 74 Q19 66 21 57 Q22 48 29 48 Q47 49 60 54 Q70 47 82 45 Q108 49 136 55 Q168 59 180 63 Q192 67 190 74 Z"/>',
        details: seam('M22 58 Q34 58 40 74') + facing + toe,
      };
    }
    case 'boot-service':
      return {
        sole: SOLES.boot,
        soleDetail: stitch('M22 76.5 H188') + seam('M18 80.5 H52') + seam('M18 84 H52'),
        upper: '<path d="M22 74 Q15 62 17 48 L19 18 Q19 12 25 12 L58 12 Q63 12 63 17 L66 38 Q70 50 94 54 Q140 58 170 61 Q191 64 190 74 Z"/>',
        details:
          seam('M70 48 Q60 60 62 74') +
          seam('M146 61 Q153 66 155 74') +
          stitch('M143 61.5 Q150 67 152 74') +
          `<path d="M19 14 Q13 14 13 20 Q13 25 19 25" fill="none" stroke="${line}" stroke-width="1.3"/>` +
          eyelets(61, 16, 67, 44, 6, line),
      };
    case 'boot-chelsea':
      return {
        sole: SOLES.boot,
        soleDetail: stitch('M22 76.5 H188') + seam('M18 80.5 H52') + seam('M18 84 H52'),
        upper: '<path d="M22 74 Q15 62 17 48 L19 16 Q19 11 25 11 L58 11 Q63 11 63 16 L66 38 Q70 51 96 55 Q142 59 172 62 Q191 65 190 74 Z"/>',
        details:
          `<path d="M34 11 Q32 34 42 52 Q52 34 50 11 Z" fill="rgba(0,0,0,0.28)" stroke="${line}" stroke-width="1"/>` +
          [37, 40, 43, 46].map((x) => `<path d="M${x} 13 L${x + (x - 42) * 0.15} ${36 + Math.abs(x - 42) * -1.2}" stroke="${detail}" stroke-width="0.7"/>`).join('') +
          `<path d="M20 11 Q17 3 23 3 Q28 4 27 11" fill="none" stroke="${line}" stroke-width="1.3"/>` +
          seam('M66 40 Q62 58 66 74'),
      };
    case 'boot-hiker':
      return {
        sole: SOLES.lug,
        soleDetail: stitch('M22 77 H189') + [30, 44, 58, 72, 86, 100, 114, 128, 142, 156, 170].map((x) => `<path d="M${x} 84 v4" stroke="${detail}" stroke-width="1.2"/>`).join(''),
        upper: '<path d="M22 74 Q14 62 17 48 L19 20 Q19 13 26 12 Q42 9 58 12 Q64 13 64 18 L67 38 Q71 50 96 54 Q140 58 170 61 Q192 64 191 74 Z"/>',
        details:
          seam('M19 22 Q40 18 63 21') +
          seam('M150 62 Q160 69 160 74') +
          seam('M72 48 Q62 60 64 74') +
          [0, 1, 2, 3, 4].map((i) => `<circle cx="${62 + i * 1.3}" cy="${18 + i * 6.5}" r="2" fill="none" stroke="${accent}" stroke-width="1.3"/>`).join(''),
      };
    case 'boot-chukka':
      return {
        sole: SOLES.crepe,
        soleDetail: seam('M20 79 H189'),
        upper: '<path d="M23 74 Q16 64 19 52 L20 32 Q20 26 26 26 L56 26 Q61 26 61 31 L64 44 Q68 53 94 56 Q140 59 172 62 Q191 65 190 74 Z"/>',
        details: seam('M64 44 Q56 58 60 74') + eyelets(60, 30, 64, 44, 3, line),
      };
    default:
      return shape('sneaker', c);
  }
}

/**
 * 產生鞋款插畫 SVG 字串
 * @param art models.json 的 art 欄位
 * @param label 給螢幕閱讀器的說明文字
 */
export function shoeSVG(art = {}, label = '') {
  const id = `g${++uid}`;
  const upper = art.upper || '#c9b8a3';
  const dark = isDark(upper);
  const c = {
    upper,
    line: '#2a2420',
    detail: dark ? 'rgba(255,255,255,0.38)' : 'rgba(42,36,32,0.55)',
    accent: art.accent || '#c9ad7f',
    mark: art.mark,
  };
  const s = shape(art.kind, c);
  return `<svg viewBox="0 0 206 96" role="img" aria-label="${label}" class="shoe-svg">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="${dark ? 0.16 : 0.5}"/>
        <stop offset="0.6" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <ellipse cx="104" cy="90" rx="88" ry="2.8" fill="rgba(31,29,26,0.12)"/>
    <path d="${s.sole}" fill="${art.sole || '#2a2420'}" stroke="${c.line}" stroke-width="1.2" stroke-linejoin="round"/>
    ${s.soleDetail || ''}
    <g fill="${upper}" stroke="${c.line}" stroke-width="1.3" stroke-linejoin="round">${s.upper}</g>
    <g fill="url(#${id})" stroke="none">${s.upper}</g>
    ${s.details || ''}
  </svg>`;
}

/** 品牌文字標誌用的縮寫（不是品牌商標） */
export function monogram(name) {
  const special = { 'DUKE + DEXTER': 'D+D', 'Crockett & Jones': 'C&J', 'Common Projects': 'CP', 'Axel Arigato': 'AA', 'Edward Green': 'EG' };
  if (special[name]) return special[name];
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
