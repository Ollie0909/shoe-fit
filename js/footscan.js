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

/** 自動找 A4 紙的四個角：從最亮處把紙「長」出來，取這塊區域的四個極端點 */
export function detectPaper(canvas) {
  const W = 480;
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
  // 從最亮的地方開始把紙「長」出來：相鄰像素亮度差很小才算同一張紙，
  // 所以紙上的漸層陰影會被包含；碰到亮度突然變化（紙的邊緣、牆、地板、腳）就停下來
  const STEP = 6;
  // 邊緣強度（Sobel）：紙的邊、牆和地板的交界都是「邊緣」，擴張時不能跨過；
  // 紙上的陰影是緩慢的漸層，強度很低，不會被擋住
  const mag = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = lum[i - W + 1] + 2 * lum[i + 1] + lum[i + W + 1] - lum[i - W - 1] - 2 * lum[i - 1] - lum[i + W - 1];
      const gy = lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1] - lum[i - W - 1] - 2 * lum[i - W] - lum[i - W + 1];
      mag[i] = Math.hypot(gx, gy) / 8;
    }
  }
  const EDGE = 3.5;
  const order = [];
  for (let i = 0; i < W * H; i++) if (sat[i] < 0.22 && lum[i] > 110 && mag[i] < EDGE) order.push(i);
  order.sort((p, q) => lum[q] - lum[p]);
  const seen = new Uint8Array(W * H);
  // 起點分散在比較亮的前一半像素裡，避免只從最亮的牆開始找
  let best = [];
  let bestScore = 0;
  const tries = Math.floor(order.length * 0.5);
  const stride = Math.max(1, Math.floor(tries / 60));
  for (let k = 0; k < tries; k += stride) {
    const start = order[k];
    if (seen[start]) continue;
    const floor = lum[start] - 95;
    const comp = [];
    const stack = [start];
    seen[start] = 1;
    let edgeTouch = 0;
    while (stack.length) {
      const i = stack.pop();
      comp.push(i);
      const x = i % W;
      const y = (i - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edgeTouch++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!seen[j] && sat[j] < 0.25 && lum[j] > floor && mag[j] < EDGE && Math.abs(lum[j] - lum[i]) <= STEP) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    // 紙應該整張在畫面裡；大面積碰到照片邊緣的通常是牆或地板，分數打折
    const score = comp.length * (edgeTouch > 20 ? 0.35 : 1);
    if (score > bestScore) [best, bestScore] = [comp, score];
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
  // 區域停在邊緣內側約 1.5 像素，把四個角往外推回紙的真正邊緣
  const cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4;
  const cy = (tl[1] + tr[1] + br[1] + bl[1]) / 4;
  return [tl, tr, br, bl].map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy) || 1;
    const push = 2.1;
    return [(x + 0.5 + ((x - cx) / d) * push) / s, (y + 0.5 + ((y - cy) / d) * push) / s];
  });
}

/** 依四個角把紙「拉正」成 210 × 297 mm 的正面圖 */
export function rectify(photo, corners) {
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

/**
 * 在拉正後的紙上自動找腳（單位 mm）
 *
 * 1. 比紙暗、或顏色明顯的像素視為「腳」
 * 2. 每一列只取「最長的一段連續範圍」（允許 2 mm 的小縫），避免把紙外的地板、雜點算進去
 * 3. 判斷方向：腳跟靠牆、貼著紙邊，小腿也會從那一端延伸出去，所以「腳碰到紙邊的那一端」是腳跟，
 *    另一端最遠的位置是腳尖。不管照片裡腳趾朝上還是朝下都能判斷
 * 4. 腳長 = 腳跟那條紙邊（牆）到腳尖的垂直距離（和用尺量腳的標準方法一樣）
 * 5. 腳寬 = 只在前掌範圍（從腳尖往回 15%–45% 腳長）找最寬的一列，不會量到腳踝或小腿
 */
export function detectFoot(rect, debug = null) {
  const W = rect.width;
  const H = rect.height;
  const px = rect.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const margin = Math.round(3 * RECT_SCALE);
  // 紙的亮度與色調：取左右兩側靠邊的區域
  const samples = [];
  for (let y = margin; y < H - margin; y += 6) {
    for (const x of [margin + 4, W - margin - 5]) {
      const i = (y * W + x) * 4;
      samples.push([px[i], px[i + 1], px[i + 2], 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]]);
    }
  }
  samples.sort((a, b) => a[3] - b[3]);
  const paperL = samples[Math.floor(samples.length * 0.75)][3];
  // 紙的色調（不管亮暗）：取比較亮的那一半樣本的平均比例
  const bright = samples.slice(Math.floor(samples.length / 2));
  const chroma = (r, g, b) => {
    const t = r + g + b || 1;
    return [r / t, g / t, b / t];
  };
  const pc = bright.reduce((acc, [r, g, b]) => chroma(r, g, b).map((v, k) => acc[k] + v / bright.length), [0, 0, 0]);
  // 判斷是不是腳（以紙本身的顏色為基準，扣掉燈光的色偏）：
  //   ‧ 皮膚的特徵是「紅明顯高於綠」：亮處約高 15–20%、暗處更多；
  //     紙上的影子就算偏暖，紅綠差也只有 10% 左右，所以不會被誤認成腳
  //   ‧ 非常暗的部分（深色襪子）也算腳；一般影子不夠暗，不會被算進去
  const ratio = (r, g, b) => [(r - g) / (r || 1), (r - b) / (r || 1)];
  const base = bright.reduce((acc, [r, g, b]) => ratio(r, g, b).map((v, k) => acc[k] + v / bright.length), [0, 0]);
  const isFoot = (x, y) => {
    const i = (y * W + x) * 4;
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    const [rg, rb] = ratio(r, g, b);
    return rg - base[0] > 0.13 || rb - base[1] > 0.33 || L < paperL * 0.35;
  };

  // 每一列：最長的一段連續「腳」（允許 2 mm 以內的縫，例如腳趾之間）
  const gapMax = Math.round(2 * RECT_SCALE);
  const minRun = 8 * RECT_SCALE;
  const rows = new Array(H).fill(null);
  for (let y = margin; y < H - margin; y++) {
    let best = null;
    let cur = null;
    let gap = 0;
    for (let x = margin; x < W - margin; x++) {
      if (isFoot(x, y)) {
        if (!cur) cur = { l: x, r: x };
        cur.r = x;
        gap = 0;
      } else if (cur) {
        gap++;
        if (gap > gapMax) {
          if (!best || cur.r - cur.l > best.r - best.l) best = cur;
          cur = null;
          gap = 0;
        }
      }
    }
    if (cur && (!best || cur.r - cur.l > best.r - best.l)) best = cur;
    // 太短是雜點；幾乎橫跨整張紙的是紙邊外的地板或牆，也不算
    if (best && best.r - best.l >= minRun && best.r - best.l < (W - 2 * margin) * 0.8) rows[y] = best;
  }
  const valid = [];
  for (let y = 0; y < H; y++) if (rows[y]) valid.push(y);
  if (debug) {
    const seg = [];
    for (const y of valid) {
      const last = seg[seg.length - 1];
      if (last && y - last[1] <= 1) last[1] = y;
      else seg.push([y, y]);
    }
    Object.assign(debug, { paperL, validRows: valid.length, segments: seg.filter((g) => g[1] - g[0] > 2).map((g) => g.join('-')).join(' ') });
  }
  if (valid.length < 100 * RECT_SCALE) return null; // 腳長不到 10 cm，偵測失敗

  // 判斷腳跟在上方還是下方：離紙邊比較近（貼著牆）的那一端是腳跟
  const firstY = valid[0];
  const lastY = valid[valid.length - 1];
  const heelAtTop = firstY - margin <= H - margin - lastY;

  // 從腳跟往腳尖走，找出連續的腳（中間斷掉超過 6 mm 就停，避免把遠處雜點當腳尖）
  const dir = heelAtTop ? 1 : -1;
  const startY = heelAtTop ? firstY : lastY;
  let toeY = startY;
  let missing = 0;
  for (let y = startY; y >= margin && y < H - margin; y += dir) {
    if (rows[y]) {
      toeY = y;
      missing = 0;
    } else if (++missing > 6 * RECT_SCALE) break;
  }
  // 腳跟貼著紙邊（靠牆）時，腳跟位置就是紙邊
  const touchesEdge = heelAtTop ? firstY - margin <= 4 * RECT_SCALE : H - margin - lastY <= 4 * RECT_SCALE;
  const heelY = touchesEdge ? (heelAtTop ? 0 : H) : startY;
  const lengthPx = Math.abs(toeY - heelY);
  if (debug) Object.assign(debug, { heelAtTop, toeY, heelY, lengthPx });
  if (lengthPx < 100 * RECT_SCALE) return null;

  // 腳尖的水平位置：腳尖那幾列的中心
  const toeRow = rows[toeY];
  const toeX = (toeRow.l + toeRow.r) / 2;

  // 腳寬：只看前掌（從腳尖往回 15%–45% 腳長）
  let widest = null;
  let widestY = toeY;
  for (let f = 0.15; f <= 0.45; f += 0.5 / lengthPx) {
    const y = Math.round(toeY - dir * f * lengthPx);
    const r = rows[y];
    if (r && (!widest || r.r - r.l > widest.r - widest.l)) {
      widest = r;
      widestY = y;
    }
  }
  if (!widest) return null;

  const mm = (v) => v / RECT_SCALE;
  return {
    heel: [mm(toeX), mm(heelY)],
    toe: [mm(toeX), mm(toeY)],
    inner: [mm(widest.l), mm(widestY)],
    outer: [mm(widest.r + 1), mm(widestY)],
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

/**
 * 示範照片：程式畫一張「自己往下拍」的照片——A4 紙短邊貼牆、腳跟靠牆、腳尖朝畫面上方，
 * 小腿從腳跟往畫面下方延伸出紙外。預設腳長 25.5 cm、腳寬 10.0 cm。
 * flip = true 時整張照片轉 180 度（模擬朋友從對面拍，腳尖朝下）
 */
export function demoPhoto({ length = 255, width = 100, flip = false } = {}) {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 1200;
  const ctx = c.getContext('2d');
  if (flip) {
    ctx.translate(900, 1200);
    ctx.rotate(Math.PI);
  }
  // 木頭地板
  const g = ctx.createLinearGradient(0, 0, 0, 1200);
  g.addColorStop(0, '#9a8268');
  g.addColorStop(1, '#7d6650');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 900, 1200);
  for (let x = -200; x < 1100; x += 120) {
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 160, 1200);
    ctx.stroke();
  }
  const corners = [[232, 150], [688, 190], [760, 1030], [140, 990]];
  const H = homography([[0, 0], [A4.w, 0], [A4.w, A4.h], [0, A4.h]], corners);
  // 牆（紙的下緣之外）
  ctx.fillStyle = '#d9d2c6';
  ctx.beginPath();
  ctx.moveTo(0, 1000);
  ctx.lineTo(140, 990);
  ctx.lineTo(760, 1030);
  ctx.lineTo(900, 1040);
  ctx.lineTo(900, 1200);
  ctx.lineTo(0, 1200);
  ctx.fill();
  // 紙
  ctx.fillStyle = '#f7f6f2';
  ctx.beginPath();
  corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.fill();
  // 腳的輪廓（紙上的 mm 座標）：腳跟貼著紙的下緣（牆），往上是腳尖
  const heelY = A4.h - 0.5;
  const cx = A4.w / 2;
  const prof = [[0, 0.0], [0.03, 0.27], [0.12, 0.33], [0.3, 0.34], [0.5, 0.4], [0.68, 0.5], [0.78, 0.49], [0.88, 0.42], [0.95, 0.3], [0.99, 0.14], [1, 0]];
  const hw = (t) => {
    for (let i = 1; i < prof.length; i++) {
      if (t <= prof[i][0]) {
        const u = (t - prof[i - 1][0]) / (prof[i][0] - prof[i - 1][0]);
        return (prof[i - 1][1] + (prof[i][1] - prof[i - 1][1]) * u) * width;
      }
    }
    return 0;
  };
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    pts.push([cx - hw(t) - (t > 0.7 ? (t - 0.7) * 10 : 0), heelY - t * length]);
  }
  for (let i = 80; i >= 0; i--) {
    const t = i / 80;
    pts.push([cx + hw(t) - (t > 0.7 ? (t - 0.7) * 10 : 0), heelY - t * length]);
  }
  ctx.fillStyle = '#d9a98a';
  ctx.strokeStyle = '#b5826a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.map((p) => project(H, p)).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 小腿：從腳踝往畫面下方（往手機的方向）延伸，越近越寬，會蓋住腳跟和紙的下緣
  const [ax1, ay1] = project(H, [cx - 36, heelY - 45]);
  const [ax2, ay2] = project(H, [cx + 36, heelY - 45]);
  const leg = ctx.createLinearGradient(0, ay1, 0, 1200);
  leg.addColorStop(0, '#d2a083');
  leg.addColorStop(1, '#c08d70');
  ctx.fillStyle = leg;
  ctx.beginPath();
  ctx.moveTo(ax1, ay1);
  ctx.quadraticCurveTo((ax1 + ax2) / 2, ay1 - 30, ax2, ay2);
  ctx.lineTo(ax2 + 70, 1200);
  ctx.lineTo(ax1 - 70, 1200);
  ctx.closePath();
  ctx.fill();
  return c;
}

/**
 * 拍攝示意圖（立體）：牆、地板、A4 紙、腳、小腿、手機，以及鏡頭朝下拍攝的範圍
 * 用等角投影（isometric）把 3D 座標（mm）畫成 2D，右邊附上「拍出來應該像這樣」的範例畫面
 */
function guideSVG() {
  const iso = ([x, y, z]) => [(x - y) * 0.866, (x + y) * 0.5 - z];
  const shapes = [];
  const add = (pts, attr) => shapes.push({ pts, ...attr });

  // 腳的輪廓與高度（腳跟在牆邊 y = 6，腳尖朝 +y）
  const fx = 145;
  const L = 250;
  const Wd = 100;
  const prof = [[0, 0.0], [0.04, 0.3], [0.15, 0.34], [0.35, 0.36], [0.55, 0.43], [0.7, 0.5], [0.82, 0.47], [0.92, 0.36], [0.98, 0.18], [1, 0]];
  const hgt = [[0, 0], [0.04, 40], [0.15, 62], [0.35, 58], [0.55, 42], [0.7, 30], [0.85, 22], [0.96, 14], [1, 0]];
  const lerp = (tab, t) => {
    for (let i = 1; i < tab.length; i++) {
      if (t <= tab[i][0]) {
        const u = (t - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]);
        return tab[i - 1][1] + (tab[i][1] - tab[i - 1][1]) * u;
      }
    }
    return 0;
  };
  const outline = (k, zf) => {
    const a = [];
    const b = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const y = 6 + t * L;
      const w = lerp(prof, t) * Wd * k;
      a.push([fx - w, y, lerp(hgt, t) * zf]);
      b.unshift([fx + w, y, lerp(hgt, t) * zf]);
    }
    return [...a, ...b];
  };
  const lens = [fx + 24, 286, 194];
  const paper = [[40, 0, 0], [250, 0, 0], [250, 297, 0], [40, 297, 0]];

  add([[-50, 0, 0], [320, 0, 0], [320, 0, 330], [-50, 0, 330]], { fill: '#ddd4c6', stroke: '#c9bfae' }); // 牆
  add([[-50, 0, 0], [320, 0, 0], [320, 420, 0], [-50, 420, 0]], { fill: '#eee6da' }); // 地板
  add(paper, { fill: '#ffffff', stroke: '#c2b7a4' }); // A4 紙
  for (const p of paper) add([lens, p], { stroke: '#a8854f', dash: '4 4', width: 1.1 }); // 拍攝範圍
  add(outline(1.05, 0), { fill: 'rgba(31,29,26,0.12)' }); // 腳的陰影
  add(outline(1, 0.55), { fill: '#dcae90', stroke: '#b5826a' }); // 腳
  add(outline(0.62, 1), { fill: '#e8c2a6' }); // 腳背
  // 腳趾：五個小圓
  [[-0.36, 0.955, 13], [-0.16, 0.985, 12], [0.03, 0.975, 11], [0.2, 0.95, 10], [0.35, 0.915, 9]].forEach(([dx, t, rr]) => {
    const cxT = fx + dx * Wd;
    const cyT = 6 + t * L;
    const ring = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ring.push([cxT + Math.cos(a) * rr * 0.8, cyT + Math.sin(a) * rr, 10]);
    }
    add(ring, { fill: '#e6b99c', stroke: '#b5826a' });
  });
  // 小腿（圓柱）：取投影後最左、最右的點當外輪廓
  const legC = [fx, 50];
  const r = 40;
  const ring = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ring.push([legC[0] + Math.cos(a) * r, legC[1] + Math.sin(a) * r * 0.9]);
  }
  const bottom = ring.map(([x, y]) => [x, y, 55]);
  const top = ring.map(([x, y]) => [x, y, 190]);
  const left = bottom.reduce((m, p) => (iso(p)[0] < iso(m)[0] ? p : m));
  const right = bottom.reduce((m, p) => (iso(p)[0] > iso(m)[0] ? p : m));
  add([left, right, [right[0], right[1], 190], [left[0], left[1], 190]], { fill: '#d6a587' });
  add(top, { fill: '#e2b597', stroke: '#c08d70' });
  // 手機（和地面平行，螢幕朝上、鏡頭在背面朝下；手機上緣朝腳尖方向）
  const ph = [[fx - 45, 140, 200], [fx + 45, 140, 200], [fx + 45, 305, 200], [fx - 45, 305, 200]];
  add([[fx, 222, 192], [fx, 222, 40]], { stroke: '#1f1d1a', dash: '2 3', width: 0.9 }); // 手機在腳的正上方
  add(ph.map(([x, y, z]) => [x, y, z - 8]), { fill: '#3a3631' });
  add(ph, { fill: '#1f1d1a' });
  add([[fx - 39, 148, 200], [fx + 39, 148, 200], [fx + 39, 297, 200], [fx - 39, 297, 200]], { fill: '#2f3a44' });

  // 投影並縮放到指定範圍
  const all = shapes.flatMap((sh) => sh.pts.map(iso));
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const box = { x: 74, y: 10, w: 180, h: 236 };
  const k = Math.min(box.w / (maxX - minX), box.h / (maxY - minY));
  const P = (p) => {
    const [x, y] = iso(p);
    return [box.x + (x - minX) * k, box.y + (y - minY) * k];
  };
  const fmtPts = (pts) => pts.map((p) => P(p).map((v) => v.toFixed(1)).join(',')).join(' ');
  let svg = shapes
    .map((sh) =>
      sh.pts.length === 2
        ? `<polyline points="${fmtPts(sh.pts)}" fill="none" stroke="${sh.stroke}" stroke-width="${sh.width || 1}" ${sh.dash ? `stroke-dasharray="${sh.dash}"` : ''}/>`
        : `<polygon points="${fmtPts(sh.pts)}" fill="${sh.fill || 'none'}" stroke="${sh.stroke || 'none'}" stroke-width="1"/>`,
    )
    .join('');
  // 鏡頭與標示
  const [lx, ly] = P(lens);
  svg += `<circle cx="${lx}" cy="${ly}" r="4.5" fill="#a8854f" stroke="#fff" stroke-width="1.5"/>`;
  const label = (p, dx, dy, text, anchor = 'start') => {
    const [x, y] = P(p);
    return `<line x1="${x}" y1="${y}" x2="${x + dx}" y2="${y + dy}" stroke="#7a746b" stroke-width="0.8"/><text x="${x + dx + (anchor === 'start' ? 3 : -3)}" y="${y + dy + 3}" font-size="9.5" fill="#1f1d1a" text-anchor="${anchor}">${text}</text>`;
  };
  svg += label(lens, -24, 30, '鏡頭朝下（手機背面）', 'end');
  svg += label([fx - 45, 140, 200], -8, -12, '手機和地面平行', 'end');
  svg += label([-50, 0, 320], 6, 10, '牆');
  svg += label([fx - 30, 30, 190], -62, -34, '你：背對牆站', 'end');
  svg += label([fx - 34, 22, 45], -66, 8, '腳跟貼牆', 'end');
  svg += label([250, 297, 0], 2, 16, 'A4 紙：短邊貼牆');
  svg += label([40, 297, 0], -6, 14, '四個角都要入鏡', 'end');

  // 右邊：拍出來的畫面
  const ox = 274;
  svg += `<text x="${ox + 50}" y="16" font-size="10" fill="#7a746b" text-anchor="middle">拍出來應該像這樣</text>
    <rect x="${ox + 4}" y="24" width="92" height="178" rx="12" fill="#1f1d1a"/>
    <rect x="${ox + 9}" y="32" width="82" height="162" rx="4" fill="#8d7a66"/>
    <rect x="${ox + 9}" y="168" width="82" height="26" fill="#d9d2c6"/>
    <rect x="${ox + 20}" y="44" width="60" height="124" fill="#fff"/>
    <path d="M${ox + 50} 56 C${ox + 63} 56 ${ox + 66} 76 ${ox + 64} 92 C${ox + 62} 110 ${ox + 59} 130 ${ox + 59} 150 L${ox + 41} 150 C${ox + 41} 130 ${ox + 37} 110 ${ox + 36} 92 C${ox + 34} 76 ${ox + 38} 56 ${ox + 50} 56 Z" fill="#dcae90" stroke="#b5826a"/>
    <path d="M${ox + 40} 146 L${ox + 60} 146 L${ox + 70} 194 L${ox + 30} 194 Z" fill="#cf9e81"/>
    ${[[20, 44], [80, 44], [80, 168], [20, 168]].map(([x, y]) => `<circle cx="${ox + x}" cy="${y}" r="3.2" fill="#c0503a"/>`).join('')}
    <text x="${ox + 50}" y="218" font-size="9.5" fill="#1f1d1a" text-anchor="middle">腳尖朝上</text>
    <text x="${ox + 50}" y="231" font-size="9.5" fill="#1f1d1a" text-anchor="middle">紙的四個角都看得到</text>
    <text x="${ox + 50}" y="244" font-size="9.5" fill="#1f1d1a" text-anchor="middle">小腿蓋到腳跟沒關係</text>`;
  return `<svg class="scan-guide" viewBox="0 0 380 262" role="img" aria-label="拍攝示意圖：A4 紙短邊貼牆，腳跟貼牆踩在紙上，手機在腳的正上方、與地面平行、鏡頭朝下，紙的四個角都要入鏡">${svg}</svg>`;
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
      ${guideSVG()}
      <ol class="scan-tips">
        <li>A4 紙放在地上，<b>短邊貼齊牆壁</b>。</li>
        <li><b>背對牆站</b>，赤腳或穿薄襪，<b>腳跟貼牆</b>踩在紙上。</li>
        <li>手機拿在胸前、<b>和地面平行</b>，螢幕朝向你、<b>鏡頭朝下</b>對著腳；畫面裡腳尖朝上。</li>
        <li>確認畫面看得到<b>紙的四個角</b>再拍。小腿擋住腳跟沒關係，程式會以紙邊（牆）當腳跟位置。</li>
        <li>光線充足、地板和白紙顏色差別明顯，偵測最準。也可以請朋友從正上方幫你拍。</li>
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
      <p class="scan-note" id="scan-note">${state.demo ? '示範照片的實際尺寸：腳長 25.5 cm、腳寬 10.0 cm。' : '腳跟要貼齊紙邊（靠牆），不然腳長會偏短。誤差約 ±3 mm，建議兩腳都量、取較大的數字。'}</p>`;
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
