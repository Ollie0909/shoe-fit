/**
 * footscan.js — 用手機拍照量腳（A4 紙當尺）
 *
 * 原理：
 *   1. A4 紙的尺寸固定（210 × 297 mm）。在照片上找到紙的四個角，就能算出「照片像素 → 真實 mm」的
 *      透視轉換（homography）。手機拍得有點斜也沒關係，這個轉換會把紙「拉正」。
 *   2. 在拉正後的紙上，找出腳跟、腳尖、腳掌最寬的兩側，量出腳長、腳寬（單位 mm）。
 *   3. 紙的四角和腳的位置都會先自動偵測，再讓使用者用手指微調。
 * 照片只在這支手機上處理，不會上傳到任何地方。
 *
 * 使用方式：openFootScan((result) => { result.lengthCm, result.widthCm })
 */

const A4 = { w: 210, h: 297 };
const RECT_SCALE = 2.4; // 拉正後的圖：每 1 mm 用幾個像素
const MAX_PHOTO = 1600; // 照片最長邊縮到多少像素再處理

// ===== 數學：透視轉換 =====

/** 高斯消去法解 n 元一次方程組 */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** 算出把 src 四點對應到 dst 四點的透視轉換矩陣 H（3×3，攤平成 9 個數字） */
export function homography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return [...solve(A, b), 1];
}

/** 用 H 轉換一個點 */
export function project(H, [x, y]) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ===== 影像處理 =====

/** 自動找 A4 紙的四個角：紙是照片中最大一塊「亮、顏色淡」的區域，取它的四個極端點 */
function detectPaper(canvas) {
  const W = 240;
  const s = W / canvas.width;
  const H = Math.round(canvas.height * s);
  const small = document.createElement('canvas');
  small.width = W;
  small.height = H;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  const sat = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = px[i * 4];
    const g = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    const mx = Math.max(r, g, b);
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[i] = mx ? (mx - Math.min(r, g, b)) / mx : 0;
  }
  const sorted = [...lum].sort((a, b) => a - b);
  const bright = Math.max(140, sorted[Math.floor(sorted.length * 0.7)] - 10);
  const isPaper = (i) => lum[i] >= bright && sat[i] < 0.22;

  // 找最大的一塊連通區域
  const seen = new Uint8Array(W * H);
  let best = [];
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || !isPaper(start)) continue;
    const comp = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      comp.push(i);
      const x = i % W;
      const y = (i - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!seen[j] && isPaper(j)) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  if (best.length < W * H * 0.04) return null;

  // 四個角 = x+y 最小（左上）、x−y 最大（右上）、x+y 最大（右下）、x−y 最小（左下）
  let tl, tr, br, bl;
  let a = Infinity;
  let b2 = -Infinity;
  let c = -Infinity;
  let d = Infinity;
  for (const i of best) {
    const x = i % W;
    const y = (i - x) / W;
    if (x + y < a) [a, tl] = [x + y, [x, y]];
    if (x - y > b2) [b2, tr] = [x - y, [x, y]];
    if (x + y > c) [c, br] = [x + y, [x, y]];
    if (x - y < d) [d, bl] = [x - y, [x, y]];
  }
  return [tl, tr, br, bl].map(([x, y]) => [(x + 0.5) / s, (y + 0.5) / s]);
}

/** 依四個角把紙「拉正」成 210 × 297 mm 的正面圖 */
function rectify(photo, corners) {
  // 判斷紙是直放還是橫放：照片中比較長的邊對應 297 mm
  const horiz = (dist(corners[0], corners[1]) + dist(corners[3], corners[2])) / 2;
  const vert = (dist(corners[0], corners[3]) + dist(corners[1], corners[2])) / 2;
  const ordered = horiz > vert ? [corners[3], corners[0], corners[1], corners[2]] : corners;
  const paper = [[0, 0], [A4.w, 0], [A4.w, A4.h], [0, A4.h]];
  const H = homography(paper, ordered); // 紙上的 mm → 照片像素

  const W = Math.round(A4.w * RECT_SCALE);
  const Hh = Math.round(A4.h * RECT_SCALE);
  const src = photo.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, photo.width, photo.height);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = Hh;
  const octx = out.getContext('2d');
  const img = octx.createImageData(W, Hh);
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const [sx, sy] = project(H, [(x + 0.5) / RECT_SCALE, (y + 0.5) / RECT_SCALE]);
      const ix = Math.min(photo.width - 1, Math.max(0, Math.round(sx)));
      const iy = Math.min(photo.height - 1, Math.max(0, Math.round(sy)));
      const si = (iy * photo.width + ix) * 4;
      const di = (y * W + x) * 4;
      img.data[di] = src.data[si];
      img.data[di + 1] = src.data[si + 1];
      img.data[di + 2] = src.data[si + 2];
      img.data[di + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** 在拉正後的紙上自動找腳：比紙暗或有顏色的像素就是腳，找最上、最下、最寬的位置（單位 mm） */
function detectFoot(rect) {
  const W = rect.width;
  const H = rect.height;
  const px = rect.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const margin = Math.round(4 * RECT_SCALE);
  // 紙的亮度：取靠近邊緣的區域
  const samples = [];
  for (let y = margin; y < H - margin; y += 6) {
    for (const x of [margin + 2, W - margin - 3]) {
      const i = (y * W + x) * 4;
      samples.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    }
  }
  samples.sort((a, b) => a - b);
  const paperL = samples[Math.floor(samples.length * 0.7)];
  const isFoot = (x, y) => {
    const i = (y * W + x) * 4;
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = Math.max(r, g, b);
    const sat = mx ? (mx - Math.min(r, g, b)) / mx : 0;
    return L < paperL - 45 || (sat > 0.2 && L < paperL - 12);
  };
  const minRun = 8 * RECT_SCALE; // 一列至少要有 8 mm 的腳，才算是腳（排除雜點）
  const rows = [];
  for (let y = margin; y < H - margin; y++) {
    const xs = [];
    for (let x = margin; x < W - margin; x++) if (isFoot(x, y)) xs.push(x);
    if (xs.length >= minRun) rows.push({ y, l: xs[Math.floor(xs.length * 0.005)], r: xs[Math.ceil(xs.length * 0.995) - 1], n: xs.length, mid: xs[Math.floor(xs.length / 2)] });
  }
  if (rows.length < 100 * RECT_SCALE) return null; // 腳長不到 10 cm，偵測失敗
  const top = rows[0];
  const bottom = rows[rows.length - 1];
  const widest = rows.reduce((a, b) => (b.r - b.l > a.r - a.l ? b : a));
  const mm = (v) => v / RECT_SCALE;
  // 腳跟（或腳尖）貼著紙邊時，偵測會被邊緣留白切掉幾 mm，直接算到紙邊
  const edgeTop = top.y <= margin + 2 ? 0 : top.y;
  const edgeBottom = bottom.y >= H - margin - 3 ? H : bottom.y;
  return {
    toe: [mm(top.mid), mm(edgeTop)],
    heel: [mm(bottom.mid), mm(edgeBottom)],
    inner: [mm(widest.l), mm(widest.y)],
    outer: [mm(widest.r), mm(widest.y)],
  };
}

/** 讀取照片（依手機拍攝方向轉正），縮到最長邊 1600 px */
async function loadPhoto(file) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const s = Math.min(1, MAX_PHOTO / Math.max(source.width, source.height));
  const c = document.createElement('canvas');
  c.width = Math.round(source.width * s);
  c.height = Math.round(source.height * s);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

/** 示範照片：程式畫一張「斜拍的 A4 紙上踩著一隻腳」，實際腳長 25.5 cm、腳寬 10.0 cm */
function demoPhoto() {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 1200;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 1200);
  g.addColorStop(0, '#8d7a66');
  g.addColorStop(1, '#6f5e4d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 900, 1200);
  for (let x = -200; x < 1100; x += 120) {
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 160, 1200);
    ctx.stroke();
  }
  const corners = [[232, 168], [688, 214], [770, 1052], [142, 1004]];
  const H = homography([[0, 0], [A4.w, 0], [A4.w, A4.h], [0, A4.h]], corners);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  corners.forEach(([x, y], i) => (i ? ctx.lineTo(x + 8, y + 10) : ctx.moveTo(x + 8, y + 10)));
  ctx.fill();
  ctx.fillStyle = '#f7f6f2';
  ctx.beginPath();
  corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.fill();
  // 腳的輪廓（紙上的 mm 座標）：腳跟在紙的下緣，往上 255 mm 是腳尖，最寬 100 mm
  const L = 255;
  const Wd = 100;
  const heelY = A4.h - 0.5; // 腳跟貼著紙邊（靠牆）
  const cx = A4.w / 2;
  const prof = [[0, 0.0], [0.03, 0.27], [0.12, 0.33], [0.3, 0.34], [0.5, 0.4], [0.68, 0.5], [0.78, 0.49], [0.88, 0.42], [0.95, 0.3], [0.99, 0.14], [1, 0]];
  const hw = (t) => {
    for (let i = 1; i < prof.length; i++) {
      if (t <= prof[i][0]) {
        const u = (t - prof[i - 1][0]) / (prof[i][0] - prof[i - 1][0]);
        return (prof[i - 1][1] + (prof[i][1] - prof[i - 1][1]) * u) * Wd;
      }
    }
    return 0;
  };
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    pts.push([cx - hw(t) - (t > 0.7 ? (t - 0.7) * 10 : 0), heelY - t * L]);
  }
  for (let i = 80; i >= 0; i--) {
    const t = i / 80;
    pts.push([cx + hw(t) - (t > 0.7 ? (t - 0.7) * 10 : 0), heelY - t * L]);
  }
  ctx.fillStyle = '#d9a98a';
  ctx.strokeStyle = '#b5826a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.map((p) => project(H, p)).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return c;
}

// ===== 畫面 =====

let modal = null;

export function openFootScan(onResult) {
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.className = 'scan-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', '用手機拍照量腳');
  modal.innerHTML = `
    <div class="scan-sheet">
      <header class="scan-head">
        <span class="scan-step"></span>
        <h2 class="scan-title"></h2>
        <button type="button" class="scan-close" aria-label="關閉">×</button>
      </header>
      <div class="scan-body"></div>
      <footer class="scan-foot"></footer>
    </div>`;
  document.body.appendChild(modal);
  document.documentElement.classList.add('scan-open');
  const $ = (s) => modal.querySelector(s);
  const close = () => {
    modal.remove();
    modal = null;
    document.documentElement.classList.remove('scan-open');
  };
  $('.scan-close').addEventListener('click', close);

  const state = { photo: null, corners: null, rect: null, foot: null, demo: false };

  function setHeader(step, title) {
    $('.scan-step').textContent = step;
    $('.scan-title').textContent = title;
  }

  // ── 第 1 步：說明與拍照 ──
  function stepIntro() {
    setHeader('1 / 3', '拍一張腳踩在 A4 紙上的照片');
    $('.scan-body').innerHTML = `
      <svg class="scan-guide" viewBox="0 0 300 200" aria-hidden="true">
        <rect x="0" y="0" width="300" height="200" fill="#efe9df"/>
        <rect x="0" y="0" width="300" height="18" fill="#d8cfc1"/>
        <text x="150" y="13" text-anchor="middle" font-size="9" fill="#7a746b">牆</text>
        <polygon points="96,18 204,18 210,190 90,190" fill="#fff" stroke="#c9bfae"/>
        <path d="M150 30 C178 30 182 70 178 100 C176 130 172 160 168 176 C164 186 136 186 132 176 C128 160 122 130 122 100 C120 70 124 30 150 30 Z" fill="#e2b99a" stroke="#b5826a" transform="rotate(180 150 104)"/>
        <rect x="238" y="40" width="34" height="62" rx="6" fill="#1f1d1a"/>
        <circle cx="255" cy="50" r="4" fill="#555"/>
        <path d="M238 70 L205 110" stroke="#a8854f" stroke-dasharray="3 3"/>
      </svg>
      <ol class="scan-tips">
        <li>A4 紙放在地上、<b>短邊貼牆</b>；赤腳或穿薄襪，<b>腳跟靠牆</b>踩在紙上。</li>
        <li>請朋友幫忙，手機盡量在腳的<b>正上方</b>往下拍；<b>整張紙的四個角都要入鏡</b>。</li>
        <li>光線充足、地板顏色和白紙有明顯差別，偵測會最準。</li>
      </ol>
      <p class="scan-privacy">照片只在這支手機上計算，不會上傳。</p>
      <input type="file" accept="image/*" capture="environment" hidden id="scan-camera">
      <input type="file" accept="image/*" hidden id="scan-library">`;
    $('.scan-foot').innerHTML = `
      <button type="button" class="btn-primary" id="scan-take">拍照</button>
      <div class="scan-row">
        <button type="button" class="btn-outline" id="scan-pick">從相簿選擇</button>
        <button type="button" class="btn-outline" id="scan-demo">用示範照片試試</button>
      </div>`;
    const onFile = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        state.photo = await loadPhoto(file);
        state.demo = false;
        stepCorners();
      } catch {
        $('.scan-privacy').textContent = '照片讀取失敗，請換一張照片再試一次。';
      }
    };
    $('#scan-camera').addEventListener('change', onFile);
    $('#scan-library').addEventListener('change', onFile);
    $('#scan-take').addEventListener('click', () => $('#scan-camera').click());
    $('#scan-pick').addEventListener('click', () => $('#scan-library').click());
    $('#scan-demo').addEventListener('click', () => {
      state.photo = demoPhoto();
      state.demo = true;
      stepCorners();
    });
  }

  // ── 第 2 步：確認紙的四個角 ──
  function stepCorners() {
    setHeader('2 / 3', '確認 A4 紙的四個角');
    const photo = state.photo;
    const auto = detectPaper(photo);
    const w = photo.width;
    const h = photo.height;
    state.corners = auto || [[w * 0.2, h * 0.15], [w * 0.8, h * 0.15], [w * 0.8, h * 0.85], [w * 0.2, h * 0.85]];
    $('.scan-body').innerHTML = `
      <p class="scan-help">${auto ? '已自動找到紙的位置。' : '沒有自動找到紙，請手動調整。'}拖曳四個圓點，對準 <b>A4 紙的四個角</b>。</p>
      <div class="scan-stage" id="stage"></div>`;
    $('.scan-foot').innerHTML = `
      <button type="button" class="btn-primary" id="scan-next">下一步：量腳</button>
      <button type="button" class="link-btn" id="scan-back">重新拍照</button>`;
    const editor = createEditor($('#stage'), photo, state.corners, {
      labels: ['1', '2', '3', '4'],
      polygon: true,
    });
    $('#scan-back').addEventListener('click', stepIntro);
    $('#scan-next').addEventListener('click', () => {
      state.corners = editor.points();
      state.rect = rectify(photo, state.corners);
      stepFoot();
    });
  }

  // ── 第 3 步：確認腳跟、腳尖、最寬處 ──
  function stepFoot() {
    setHeader('3 / 3', '確認腳的位置');
    const rect = state.rect;
    const auto = detectFoot(rect);
    const toPx = (p) => [p[0] * RECT_SCALE, p[1] * RECT_SCALE];
    const def = { heel: [A4.w / 2, A4.h - 15], toe: [A4.w / 2, 30], inner: [A4.w / 2 - 50, 100], outer: [A4.w / 2 + 50, 100] };
    const f = auto || def;
    $('.scan-body').innerHTML = `
      <p class="scan-help">${auto ? '已自動找到腳的位置，' : '沒有自動找到腳，'}請確認<b>腳跟、腳尖</b>和<b>腳掌最寬的兩側</b>位置正確。</p>
      <div class="scan-result">
        <div><span>腳長</span><b id="r-len">—</b></div>
        <div><span>腳寬</span><b id="r-wid">—</b></div>
      </div>
      <div class="scan-stage scan-stage-rect" id="stage"></div>
      <p class="scan-note" id="scan-note">${state.demo ? '示範照片的實際尺寸：腳長 25.5 cm、腳寬 10.0 cm。' : '誤差約 ±3 mm。建議兩腳都量，取較大的數字。'}</p>`;
    $('.scan-foot').innerHTML = `
      <button type="button" class="btn-primary" id="scan-use">使用這個結果</button>
      <button type="button" class="link-btn" id="scan-back">回上一步調整紙的位置</button>`;
    let measured = null;
    const update = (pts) => {
      const mm = pts.map((p) => [p[0] / RECT_SCALE, p[1] / RECT_SCALE]);
      const len = dist(mm[0], mm[1]);
      const wid = dist(mm[2], mm[3]);
      measured = { lengthCm: Math.round(len) / 10, widthCm: Math.round(wid) / 10 };
      $('#r-len').textContent = `${measured.lengthCm.toFixed(1)} cm`;
      $('#r-wid').textContent = `${measured.widthCm.toFixed(1)} cm`;
      const odd = measured.lengthCm < 18 || measured.lengthCm > 33 || measured.widthCm / measured.lengthCm < 0.3 || measured.widthCm / measured.lengthCm > 0.5;
      $('#scan-use').disabled = odd;
      if (odd) $('#scan-note').textContent = '數字不太合理，請確認四個點的位置。';
    };
    createEditor($('#stage'), rect, [toPx(f.heel), toPx(f.toe), toPx(f.inner), toPx(f.outer)], {
      labels: ['跟', '尖', '寬', '寬'],
      lines: [[0, 1], [2, 3]],
      grid: true,
      heightRatio: 0.44,
      onChange: update,
    });
    $('#scan-back').addEventListener('click', stepCorners);
    $('#scan-use').addEventListener('click', () => {
      if (!measured) return;
      close();
      onResult(measured);
    });
  }

  stepIntro();
}

/**
 * 可拖曳的標記點編輯器
 * @param stage  放圖片的容器
 * @param canvas 要顯示的圖（照片或拉正後的紙）
 * @param pts    初始點（圖片像素座標）
 */
function createEditor(stage, canvas, pts, { labels, polygon = false, lines = [], grid = false, heightRatio = 0.58, onChange = () => {} }) {
  const points = pts.map((p) => [...p]);
  const maxH = Math.min(window.innerHeight * heightRatio, 640);
  const scale = Math.min(stage.clientWidth / canvas.width, maxH / canvas.height);
  const dw = canvas.width * scale;
  const dh = canvas.height * scale;
  stage.style.width = `${dw}px`;
  stage.style.height = `${dh}px`;

  const view = document.createElement('canvas');
  view.width = Math.round(dw * (window.devicePixelRatio || 1));
  view.height = Math.round(dh * (window.devicePixelRatio || 1));
  view.className = 'scan-canvas';
  view.getContext('2d').drawImage(canvas, 0, 0, view.width, view.height);
  stage.appendChild(view);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'scan-overlay');
  svg.setAttribute('viewBox', `0 0 ${dw} ${dh}`);
  stage.appendChild(svg);

  const loupe = document.createElement('canvas');
  loupe.className = 'scan-loupe';
  loupe.width = 220;
  loupe.height = 220;
  loupe.hidden = true;
  stage.appendChild(loupe);

  const handles = points.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'scan-handle';
    b.textContent = labels[i];
    b.setAttribute('aria-label', `標記點 ${labels[i]}`);
    stage.appendChild(b);
    return b;
  });

  function draw() {
    let s = '';
    if (grid) {
      // 每 1 cm 一條淡淡的格線（拉正後的紙）
      const step = 10 * RECT_SCALE * scale;
      for (let x = step; x < dw; x += step) s += `<line x1="${x}" y1="0" x2="${x}" y2="${dh}" class="g"/>`;
      for (let y = step; y < dh; y += step) s += `<line x1="0" y1="${y}" x2="${dw}" y2="${y}" class="g"/>`;
    }
    const d = points.map((p) => [p[0] * scale, p[1] * scale]);
    if (polygon) s += `<polygon points="${d.map((p) => p.join(',')).join(' ')}" class="poly"/>`;
    for (const [a, b] of lines) s += `<line x1="${d[a][0]}" y1="${d[a][1]}" x2="${d[b][0]}" y2="${d[b][1]}" class="ln"/>`;
    svg.innerHTML = s;
    handles.forEach((h, i) => {
      h.style.left = `${d[i][0]}px`;
      h.style.top = `${d[i][1]}px`;
    });
    onChange(points);
  }

  function showLoupe(i) {
    const [x, y] = points[i];
    const ctx = loupe.getContext('2d');
    const z = 3; // 放大倍率
    const r = loupe.width / 2 / z / scale;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, loupe.width, loupe.height);
    ctx.drawImage(canvas, x - r, y - r, r * 2, r * 2, 0, 0, loupe.width, loupe.height);
    ctx.strokeStyle = '#c0503a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(loupe.width / 2, 20);
    ctx.lineTo(loupe.width / 2, loupe.height - 20);
    ctx.moveTo(20, loupe.height / 2);
    ctx.lineTo(loupe.width - 20, loupe.height / 2);
    ctx.stroke();
    loupe.hidden = false;
    // 放大鏡放在手指的另一側，避免被手指擋住
    const px = x * scale;
    const left = px > dw / 2 ? 8 : dw - 118;
    loupe.style.left = `${left}px`;
    loupe.style.top = '8px';
  }

  handles.forEach((h, i) => {
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      h.classList.add('is-drag');
      const box = stage.getBoundingClientRect();
      const move = (ev) => {
        const x = Math.min(dw, Math.max(0, ev.clientX - box.left));
        const y = Math.min(dh, Math.max(0, ev.clientY - box.top));
        points[i] = [x / scale, y / scale];
        draw();
        showLoupe(i);
      };
      const up = () => {
        h.classList.remove('is-drag');
        loupe.hidden = true;
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
      showLoupe(i);
    });
  });

  draw();
  return { points: () => points.map((p) => [...p]) };
}
