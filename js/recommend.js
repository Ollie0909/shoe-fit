/**
 * recommend.js — 尺寸推薦邏輯
 *
 * 這個檔案只負責「計算」，不處理畫面。所有資料（品牌、鞋款、尺寸表、評論）
 * 都由外面傳進來，所以之後換成真實資料時，只要替換 data/ 裡的 JSON，這裡不用改。
 *
 * 單位約定：
 * - 腳長在計算時用「公釐（mm）」；使用者輸入的公分會先乘以 10
 * - 尺寸一律用「該鞋款自己的尺碼制」計算（UK / US / EU / IT）
 * - 「偏移」的單位是「號」：-1 = 小一號，-0.5 = 小半號，+1 = 大一號
 *
 * 推薦流程（對應下方 recommend() 函式的步驟 1～6）：
 *   1. 腳長 → 標準尺寸（有品牌官方對照表就用官方表，沒有就用通用表）
 *   2. 套用鞋款的尺寸偏移（例如 Common Projects 要小一號）
 *   3. 用腳長相近（±0.5 cm）買家的實際結果修正
 *   4. 取整成實際買得到的尺碼（有沒有半號、介於兩號之間往上還是往下）
 *   5. 用腳寬／腳長比例判斷腳型，對照楦頭寬窄給提醒
 *   6. 計算信心程度，並檢查官方說法和買家回饋是否一致
 */

// ===== 可調整的參數（改這裡就能調整推薦行為）=====
export const SETTINGS = {
  // 「腳長相近」的範圍：使用者腳長 ±0.5 cm 內的評論才拿來修正
  neighborRangeCm: 0.5,

  // 評論的權重 = n / (n + 5)，n 是相近評論數
  // 例：5 則評論 → 權重 50%；15 則 → 75%。評論越多，越相信買家、越不依賴預設偏移
  reviewPriorWeight: 5,

  // 腳寬 ÷ 腳長 的比例：≤ 0.36 視為窄腳，≥ 0.40 視為寬腳（經驗值，可依實測調整）
  footShape: { narrowMax: 0.36, wideMin: 0.4 },

  // 計算結果落在兩號之間的這個區間（以「一個尺碼間距」為 1）時，
  // 才套用品牌「介於兩號時往上／往下」的規則；其他情況取最接近的尺碼
  betweenZone: [0.25, 0.75],

  // 官方對照表只列到最小尺碼的上限，比上限再小這麼多 mm 就提醒「可能沒有你的尺碼」
  officialChartLowerSpanMm: 9,

  // 一位買家「不同意官方」的門檻：他最後合腳的尺寸跟官方建議差 0.9 號以上（將近一號）
  disagreeGap: 0.9,

  // 判定「官方與買家意見分歧」：至少 3 則相近評論，且
  //   不同意官方的人 ≥ 35%，或 買家平均偏移跟官方差 ≥ 0.5 號
  divergence: { minNeighbors: 3, disagreeShare: 0.35, meanGap: 0.5 },

  // 信心分數（滿分 100）的四個來源與配分
  confidence: {
    countFull: 15, // 相近評論達 15 則，「評論數量」拿滿分
    max: { count: 35, agreement: 35, guide: 20, consistency: 10 },
    guideScore: { official: 20, retailer: 15, unverified: 8 },
    levels: { high: 75, medium: 50 }, // ≥75 高、50–74 中、<50 低
  },
};

export const SYSTEM_LABELS = {
  UK: '英國尺碼（UK）',
  US: '美國尺碼（US）',
  EU: '歐洲尺碼（EU）',
  IT: '義大利尺碼（IT）',
};

export const RELIABILITY_LABELS = {
  official: '官方尺寸指南',
  retailer: '零售商／社群整理',
  unverified: '待驗證',
};

const EPS = 1e-6;

// ===== 小工具 =====

/** 四捨五入到最接近的 step（例如 step = 0.5 就是取到半號） */
export function roundTo(x, step) {
  return Math.round((x + EPS) / step) * step;
}

/** 數字顯示：整數不帶小數，半號顯示 .5，其他顯示一位小數 */
export function fmt(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(/\.0$/, '');
}

/** 帶正負號的數字：0.5 → +0.5 */
function fmtSigned(n) {
  return (n > EPS ? '+' : '') + fmt(n);
}

/** 把偏移量（號）轉成中文：-1 → 小一號、0.5 → 大半號 */
export function offsetLabel(v) {
  const r = roundTo(v, 0.5);
  if (Math.abs(r) < EPS) return '標準尺寸';
  const mag = Math.abs(r);
  const words = { 0.5: '半號', 1: '一號', 1.5: '一號半', 2: '兩號', 2.5: '兩號半', 3: '三號' };
  return (r < 0 ? '小' : '大') + (words[mag] || `${fmt(mag)} 號`);
}

function average(arr) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 線性內插：在 rows 表中，用 xKey 欄位的值 x 查出 yKey 欄位的值 */
function interpolate(rows, xKey, yKey, x) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (x <= first[xKey]) return { value: first[yKey], clamped: x < first[xKey] - EPS };
  if (x >= last[xKey]) return { value: last[yKey], clamped: x > last[xKey] + EPS };
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (x <= b[xKey]) {
      const t = (x - a[xKey]) / (b[xKey] - a[xKey]);
      return { value: a[yKey] + t * (b[yKey] - a[yKey]), clamped: false };
    }
  }
  return { value: last[yKey], clamped: true };
}

/** 尺碼制對應到通用表的哪一欄。IT（義大利）尺碼的數字沿用 EU 欄 */
function columnFor(system, gender) {
  if (system === 'UK') return 'uk';
  if (system === 'EU' || system === 'IT') return 'eu';
  if (system === 'US') return gender === '女' ? 'usW' : 'usM';
  throw new Error(`不認得的尺碼制：${system}`);
}

/** 這個鞋款的尺碼間距：有半號 = 0.5，只有整數號 = 1 */
export function stepOf(model) {
  return model.halfSizes ? 0.5 : 1;
}

/** 這個鞋款買得到的最小、最大尺碼 */
function sizeRangeOf(model, charts) {
  if (model.sizeChart) {
    const rows = charts.official[model.sizeChart].rows;
    return [rows[0].size, rows[rows.length - 1].size];
  }
  return model.sizeRange || [-Infinity, Infinity];
}

// ===== 步驟 1：腳長 → 標準尺寸 =====

/**
 * 依腳長算出「標準尺寸」（還沒套用鞋款偏移）。
 * - 品牌有官方腳長對照表 → 直接查官方表（結果是整數號，因為官方表已經決定好歸屬）
 * - 沒有 → 用通用表內插，得到連續值（例如 UK 7.3），保留「介於兩號之間」的資訊
 */
export function standardSize(footMm, model, charts) {
  if (model.sizeChart) {
    const chart = charts.official[model.sizeChart];
    const rows = chart.rows;
    let row = rows.find((r) => footMm <= r.maxMm);
    const tooLong = !row;
    if (!row) row = rows[rows.length - 1];
    const tooShort = footMm < rows[0].maxMm - SETTINGS.officialChartLowerSpanMm;
    return {
      size: row.size,
      official: true,
      chartName: chart.name,
      outOfRange: tooLong ? 'long' : tooShort ? 'short' : null,
    };
  }
  const rows = charts.generic.rows;
  const col = columnFor(model.sizeSystem, model.gender);
  const r = interpolate(rows, 'footMm', col, footMm);
  return {
    size: r.value,
    official: false,
    chartName: charts.generic.name,
    outOfRange: r.clamped ? (footMm < rows[0].footMm ? 'short' : 'long') : null,
  };
}

/** 使用者的「通用標準尺寸」（不分品牌），顯示給使用者參考 */
export function genericSizes(footMm, charts) {
  const rows = charts.generic.rows;
  const get = (col) => roundTo(interpolate(rows, 'footMm', col, footMm).value, 0.5);
  return { uk: get('uk'), usM: get('usM'), usW: get('usW'), eu: get('eu') };
}

// ===== 步驟 3 會用到：從一則評論推算「這個人真正合腳的尺寸」 =====

/**
 * 評論只告訴我們「買了幾號、結果太小／剛好／太大」。
 * 推算方式：太小 → 合腳尺寸再大一格；太大 → 再小一格；剛好 → 就是買的那號。
 * 再減掉這位買家自己的標準尺寸，就得到「他需要比標準尺寸大／小幾號」（偏移）。
 * 用「相對偏移」而不是絕對尺寸，不同腳長的人才能放在一起比較。
 */
export function reviewerOffset(review, model, charts) {
  const step = stepOf(model);
  const adjust = review.fit === '太小' ? step : review.fit === '太大' ? -step : 0;
  const bestSize = review.purchasedSize + adjust;
  const std = standardSize(review.footLengthCm * 10, model, charts).size;
  return { bestSize, offset: bestSize - std };
}

// ===== 步驟 4：取整成買得到的尺碼 =====

/**
 * - 算出來剛好在兩號中間（betweenZone）→ 依品牌規則往上／往下
 * - 其他情況 → 取最接近的尺碼
 * - 官方對照表已經把「介於兩號往上拿」算進去了，所以只有真正卡在正中間才套規則
 */
function roundToAvailable(raw, step, rule, fromOfficialChart) {
  const lower = Math.floor((raw + EPS) / step) * step;
  const frac = (raw - lower) / step; // 0 = 剛好在 lower，接近 1 = 接近上一號
  if (frac < EPS) return { size: lower, between: false };
  const [lo, hi] = SETTINGS.betweenZone;
  const between = fromOfficialChart ? Math.abs(frac - 0.5) < 0.05 : frac >= lo && frac <= hi;
  if (between && rule === 'up') return { size: lower + step, between: true };
  if (between && rule === 'down') return { size: lower, between: true };
  return { size: frac < 0.5 ? lower : lower + step, between };
}

// ===== 尺碼換算（建議尺寸 → US / UK / EU） =====

/** 把某個鞋款的尺碼數字，換算成其他市場的標示 */
export function convertSize(size, model, charts, gender) {
  if (model.sizeChart) {
    const chart = charts.official[model.sizeChart];
    const row = chart.rows.find((r) => Math.abs(r.size - size) < EPS);
    if (row) return { uk: row.size, us: row.us, usLabel: chart.usLabel, eu: row.eu };
  }
  const rows = charts.generic.rows;
  const col = columnFor(model.sizeSystem, model.gender);
  // 先由尺碼反查對應的腳長，再用腳長查其他欄位
  const footMm = interpolate(rows, col, 'footMm', size).value;
  const get = (c) => roundTo(interpolate(rows, 'footMm', c, footMm).value, 0.5);
  const g = model.gender === '中性' ? gender : model.gender;
  return {
    uk: get('uk'),
    us: get(g === '女' ? 'usW' : 'usM'),
    usLabel: g === '女' ? 'US 女' : 'US 男',
    eu: get('eu'),
  };
}

// ===== 步驟 5：腳型與楦頭寬窄 =====

/** 腳寬 ÷ 腳長 判斷腳型；沒填腳寬就回傳 null */
export function footShape(lengthCm, widthCm) {
  if (!widthCm) return null;
  // 取到小數第三位再比較，避免 9.6 ÷ 24 = 0.39999… 這類誤差
  const ratio = Math.round((widthCm / lengthCm) * 1000) / 1000;
  const { narrowMax, wideMin } = SETTINGS.footShape;
  const type = ratio >= wideMin ? '寬' : ratio <= narrowMax ? '窄' : '標準';
  return { ratio, type };
}

function widthAdvice(shape, model, recommendedSize, modelReviews, allModels, gender, sysPrefix) {
  if (!shape) {
    return { level: 'none', title: '沒有填腳寬', message: '填寫腳寬，就能判斷這雙鞋的楦頭寬窄適不適合你。' };
  }
  const step = stepOf(model);
  const ratioText = `你的腳寬／腳長比例是 ${shape.ratio.toFixed(3)}（${shape.type}腳）`;

  // 同樣是寬腳的買家，有多少人覺得這雙偏窄？
  const wideReviewers = modelReviews.filter(
    (r) => r.footWidthCm && r.footWidthCm / r.footLengthCm >= SETTINGS.footShape.wideMin,
  );
  const tightShare = wideReviewers.length
    ? wideReviewers.filter((r) => r.widthFeel === '偏窄').length / wideReviewers.length
    : null;
  const peerText =
    wideReviewers.length >= 3
      ? `寬腳的 ${wideReviewers.length} 位（模擬）買家中，${Math.round(tightShare * 100)}% 覺得偏窄。`
      : '';

  if (shape.type === '寬' && model.toeWidth === '窄') {
    // 列出同性別、楦頭不窄的其他款，優先同類型
    const candidates = allModels.filter(
      (m) => m.id !== model.id && m.toeWidth !== '窄' && (m.gender === gender || m.gender === '中性'),
    );
    const sameCategory = candidates.filter((m) => m.category === model.category);
    const suggestions = (sameCategory.length ? sameCategory : candidates).slice(0, 3);
    const altSize = recommendedSize + step;
    const message = model.halfSizes
      ? `${ratioText}，但這雙的楦頭偏窄（${model.toeNote}）。建議比上面的建議再加半號（${sysPrefix} ${fmt(altSize)}），或考慮楦頭較寬的款式。`
      : `${ratioText}，但這雙的楦頭偏窄（${model.toeNote}）。這款沒有半號，直接加一號（${sysPrefix} ${fmt(altSize)}）可能太長、容易掉跟，建議優先考慮楦頭較寬的款式。`;
    return { level: 'strong', title: '寬度提醒：腳偏寬、楦頭偏窄', message, peerText, altSize, suggestions };
  }
  if (shape.type === '寬' && model.toeWidth === '標準') {
    const soft = model.stretch === 'high' ? '這雙材質會隨穿著撐開，前幾次稍緊通常會改善。' : '皮革較硬時，前幾次穿可能會壓腳。';
    return { level: 'mild', title: '寬度提醒：腳偏寬', message: `${ratioText}，這雙是標準楦，多數情況可以穿。${soft}`, peerText };
  }
  if (shape.type === '窄' && model.toeWidth === '寬') {
    return {
      level: 'mild',
      title: '寬度提醒：腳偏窄、楦頭偏寬',
      message: `${ratioText}，這雙楦頭寬鬆（${model.toeNote}），前掌可能有空隙或容易掉跟，可考慮加鞋墊。`,
      peerText: '',
    };
  }
  if (shape.type === '標準' && model.toeWidth === '窄') {
    return {
      level: 'ok',
      title: '寬度：應該可以',
      message: `${ratioText}，這雙楦頭偏窄（${model.toeNote}），標準腳型通常可以穿；如果你腳背較高或前掌較厚，可能會覺得緊。`,
      peerText: '',
    };
  }
  return { level: 'ok', title: '寬度：應該沒問題', message: `${ratioText}，這雙的楦頭是「${model.toeWidth}」（${model.toeNote}），寬度應該合適。`, peerText: shape.type === '寬' ? peerText : '' };
}

// ===== 主函式 =====

/**
 * @param input   { footLengthCm, footWidthCm(可空), gender: '男' | '女' }
 * @param model   models.json 的一筆鞋款
 * @param brand   brands.json 的一筆品牌
 * @param reviews reviews.json 的全部評論（這裡會篩出該鞋款）
 * @param charts  size-charts.json
 * @param allModels 全部鞋款（用來推薦替代款）
 */
export function recommend(input, model, brand, reviews, charts, allModels = []) {
  const { footLengthCm, footWidthCm, gender } = input;
  const footMm = Math.round(footLengthCm * 10);
  const step = stepOf(model);
  const sys = model.sizeSystem;
  const steps = []; // 計算過程，給畫面顯示「這個數字怎麼來的」
  const notices = []; // 額外提醒（超出尺碼範圍等）

  // ── 步驟 1：腳長 → 標準尺寸 ──
  const std = standardSize(footMm, model, charts);
  steps.push(`依「${std.chartName}」，腳長 ${fmt(footLengthCm)} cm 對應${std.official ? '官方尺寸' : '標準尺寸'} ${sys} ${fmt(std.size)}${std.official ? '' : '（連續值，保留介於兩號之間的資訊）'}。`);
  if (std.outOfRange === 'short') notices.push('你的腳長比這個尺寸表的最小尺碼還短，這款可能沒有適合你的尺寸。');
  if (std.outOfRange === 'long') notices.push('你的腳長超過這個尺寸表的最大尺碼，這款可能沒有適合你的尺寸。');

  // ── 步驟 2：套用鞋款的尺寸偏移 ──
  const officialOffset = model.sizeOffset;
  steps.push(`這款預設尺寸偏移 ${fmtSigned(officialOffset)} 號（${officialOffset === 0 ? '照標準尺寸買' : offsetLabel(officialOffset)}，來源：${RELIABILITY_LABELS[model.reliability]}）→ ${sys} ${fmt(std.size + officialOffset)}。`);

  // ── 步驟 3：用腳長相近買家的實際結果修正 ──
  const modelReviews = reviews
    .filter((r) => r.modelId === model.id)
    .map((r) => ({ ...r, ...reviewerOffset(r, model, charts) }));
  const neighbors = modelReviews.filter(
    (r) => Math.abs(r.footLengthCm - footLengthCm) <= SETTINGS.neighborRangeCm + EPS,
  );
  const n = neighbors.length;
  const offsets = neighbors.map((r) => r.offset);
  const meanOffset = n ? average(offsets) : null;
  const medianOffset = n ? median(offsets) : null;
  const weight = n / (n + SETTINGS.reviewPriorWeight);
  // 綜合偏移 = 預設偏移 ×（1 − 權重）＋ 買家平均偏移 × 權重
  const finalOffset = n ? (1 - weight) * officialOffset + weight * meanOffset : officialOffset;
  if (n) {
    steps.push(`腳長 ±${SETTINGS.neighborRangeCm} cm 內有 ${n} 則評論，他們最後合腳的尺寸平均是標準尺寸 ${fmtSigned(meanOffset)} 號；評論權重 ${Math.round(weight * 100)}%（= ${n} ÷ (${n} + ${SETTINGS.reviewPriorWeight})），綜合偏移為 ${fmtSigned(finalOffset)} 號。`);
  } else {
    steps.push(`腳長 ±${SETTINGS.neighborRangeCm} cm 內沒有評論，只能使用預設偏移。`);
  }

  // ── 步驟 4：取整成買得到的尺碼 ──
  const raw = std.size + finalOffset;
  const rounded = roundToAvailable(raw, step, model.betweenSizes, std.official);
  let recommendedSize = rounded.size;
  const [minSize, maxSize] = sizeRangeOf(model, charts);
  if (recommendedSize < minSize) {
    notices.push(`算出的尺寸（${sys} ${fmt(recommendedSize)}）比這款最小的 ${sys} ${fmt(minSize)} 還小，這款可能不適合你。`);
    recommendedSize = minSize;
  } else if (recommendedSize > maxSize) {
    notices.push(`算出的尺寸（${sys} ${fmt(recommendedSize)}）比這款最大的 ${sys} ${fmt(maxSize)} 還大，這款可能不適合你。`);
    recommendedSize = maxSize;
  }
  const ruleText = { up: '介於兩號時往上拿', down: '介於兩號時往下拿', nearest: '取最接近的尺碼' }[model.betweenSizes];
  const useRule = rounded.between && model.betweenSizes !== 'nearest';
  steps.push(`計算值 ${sys} ${fmt(raw)}；這款${model.halfSizes ? '有半號' : '只有整數號'}，${useRule ? `落在兩號之間，依品牌規則「${ruleText}」` : '取最接近的尺碼'} → 建議 ${sys} ${fmt(recommendedSize)}。`);

  // 相近買家中，最後合腳的尺寸和這次建議一致（相差不到半格）的比例
  const recommendedOffset = recommendedSize - std.size;
  const matchCount = neighbors.filter((r) => Math.abs(r.offset - recommendedOffset) <= step / 2 + EPS).length;
  const neighborMatch = { n, count: matchCount, share: n ? matchCount / n : 0 };

  // ── 步驟 5：寬度 ──
  const shape = footShape(footLengthCm, footWidthCm);
  const width = widthAdvice(shape, model, recommendedSize, modelReviews, allModels, gender, sys);

  // ── 步驟 6：信心程度與意見分歧 ──
  const C = SETTINGS.confidence;
  // (a) 相近評論數量
  const countScore = Math.min(n / C.countFull, 1) * C.max.count;
  // (b) 意見一致度：最後合腳的尺寸跟中位數相差不到半號的人占多少
  const agreeShare = n ? neighbors.filter((r) => Math.abs(r.offset - medianOffset) <= 0.5 + EPS).length / n : 0;
  const agreementScore = agreeShare * C.max.agreement;
  // (c) 有沒有官方或零售商尺寸指南
  const guideScore = C.guideScore[model.reliability];
  // (d) 官方說法和買家回饋是否一致
  const hasGuide = model.reliability !== 'unverified';
  const disagreeing = neighbors.filter((r) => Math.abs(r.offset - officialOffset) >= SETTINGS.disagreeGap);
  const disagreeShare = n ? disagreeing.length / n : 0;
  const isDivergent =
    hasGuide &&
    n >= SETTINGS.divergence.minNeighbors &&
    (disagreeShare >= SETTINGS.divergence.disagreeShare ||
      Math.abs(meanOffset - officialOffset) >= SETTINGS.divergence.meanGap);
  let consistencyScore;
  let consistencyText;
  if (!hasGuide) {
    consistencyScore = C.max.consistency / 2;
    consistencyText = '沒有可查證的官方說法可以比對（給一半分數）';
  } else if (n < SETTINGS.divergence.minNeighbors) {
    consistencyScore = C.max.consistency / 2;
    consistencyText = '相近評論太少，無法判斷是否一致（給一半分數）';
  } else if (isDivergent) {
    consistencyScore = 0;
    consistencyText = '官方說法和買家回饋不一致（兩邊說法見結果頁上方）';
  } else {
    consistencyScore = C.max.consistency;
    consistencyText = '官方說法和買家回饋一致';
  }

  const score = Math.round(countScore + agreementScore + guideScore + consistencyScore);
  const level = score >= C.levels.high ? '高' : score >= C.levels.medium ? '中' : '低';
  const confidence = {
    score,
    level,
    parts: [
      { label: '相近評論數量', score: countScore, max: C.max.count, detail: `腳長 ±${SETTINGS.neighborRangeCm} cm 內有 ${n} 則評論（${C.countFull} 則以上拿滿分）` },
      { label: '意見一致程度', score: agreementScore, max: C.max.agreement, detail: n ? `${Math.round(agreeShare * 100)}% 的人最後合腳的尺寸彼此相差不到半號` : '沒有相近評論' },
      { label: '尺寸指南', score: guideScore, max: C.max.guide, detail: { official: '有品牌官方尺寸指南', retailer: '有零售商／社群整理的尺寸建議', unverified: '沒有可查證的指南，偏移為待驗證的預設值' }[model.reliability] },
      { label: '官方與買家一致', score: consistencyScore, max: C.max.consistency, detail: consistencyText },
    ],
  };

  // 意見分歧：把兩邊說法都整理出來
  let divergence = null;
  if (isDivergent) {
    const bigger = neighbors.filter((r) => r.offset - officialOffset >= SETTINGS.disagreeGap).length;
    const smaller = neighbors.filter((r) => officialOffset - r.offset >= SETTINGS.disagreeGap).length;
    const same = n - bigger - smaller;
    const guidance = roundTo(std.size + officialOffset, step);
    const upsizedTooBig = neighbors.filter((r) => r.purchasedSize > guidance + EPS && r.fit === '太大').length;
    const direction = Math.sign(meanOffset - officialOffset) || (bigger >= smaller ? 1 : -1);
    const altSize = recommendedSize + direction * step;
    divergence = {
      n,
      bigger,
      same,
      smaller,
      direction,
      official: model.officialNote,
      buyers:
        `腳長相近的 ${n} 則（模擬）評論中：${bigger} 則最後合腳的尺寸比官方建議大、${same} 則和官方建議差不多、${smaller} 則比官方建議小。` +
        (upsizedTooBig ? `其中 ${upsizedTooBig} 則是買大之後反而太鬆（例如走路掉跟）。` : ''),
      why: `兩邊說法不一致，而且相近買家中只有 ${Math.round(agreeShare * 100)}% 意見一致，所以「官方與買家一致」這項是 0 分，信心降為「${level}」。`,
      altSize,
      altText: direction > 0 ? '如果你腳背較高、或過去穿這個品牌覺得偏緊，可以考慮' : '如果你腳型偏瘦、或過去穿這個品牌覺得偏鬆，可以考慮',
    };
  }

  // ── 評論重點（用該鞋款全部評論，樣本較穩定）──
  const total = modelReviews.length;
  const buckets = new Map();
  for (const r of modelReviews) {
    const k = roundTo(r.offset, step);
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  const stdName = std.official ? '官方對照表尺寸' : '標準尺寸';
  const distribution = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, count]) => ({
      offset: k,
      label: Math.abs(k) < EPS ? (std.official ? '照官方表' : '標準尺寸') : offsetLabel(k),
      count,
      share: total ? count / total : 0,
    }));
  const top = distribution.reduce((a, b) => (b.count > (a ? a.count : -1) ? b : a), null);
  const fitCounts = { 太小: 0, 剛好: 0, 太大: 0 };
  const widthCounts = { 偏窄: 0, 剛好: 0, 偏寬: 0 };
  for (const r of modelReviews) {
    fitCounts[r.fit] += 1;
    if (r.widthFeel in widthCounts) widthCounts[r.widthFeel] += 1;
  }
  const stretchMentions = modelReviews.filter((r) => r.materialNote).length;
  const allMean = total ? average(modelReviews.map((r) => r.offset)) : 0;
  let tendency;
  if (allMean <= -0.25) tendency = `整體偏大：買家最後合腳的尺寸，平均比${stdName}小 ${fmt(-allMean)} 號。`;
  else if (allMean >= 0.25) tendency = `整體偏小：買家最後合腳的尺寸，平均比${stdName}大 ${fmt(allMean)} 號。`;
  else tendency = `尺寸大致正常：買家最後合腳的尺寸，平均和${stdName}差不到 0.25 號。`;

  let headline = '';
  if (top) {
    const pct = Math.round(top.share * 100);
    headline = Math.abs(top.offset) < EPS ? `${pct}% 的人照${stdName}買剛好` : `${pct}% 的人買${top.label}剛好`;
  }

  const insights = {
    total,
    tendency,
    headline,
    distribution,
    fitCounts,
    widthCounts,
    toe: `楦頭${model.toeWidth}：${model.toeNote}`,
    material: {
      high: `${model.material}：會隨穿著撐開，寬度會變鬆（長度不會變），一開始稍緊沒關係。`,
      some: `${model.material}：穿一陣子會稍微服貼，但不會差太多。`,
      low: `${model.material}：幾乎不會撐開，尺寸要一次買對。`,
    }[model.stretch],
    stretchMentions,
  };

  // ── 代表性評論（2–3 則）──
  const representative = pickRepresentative(neighbors.length ? neighbors : modelReviews, footLengthCm, divergence, width, officialOffset);

  const conversions = convertSize(recommendedSize, model, charts, gender);
  const yourSizes = genericSizes(footMm, charts);

  return {
    model,
    brand,
    system: sys,
    systemLabel: SYSTEM_LABELS[sys],
    recommendedSize,
    conversions,
    yourSizes,
    standard: std,
    officialOffset,
    finalOffset,
    neighbors: n,
    neighborMatch,
    steps,
    notices,
    confidence,
    width,
    divergence,
    insights,
    representative,
  };
}

/** 挑代表性評論：一則腳長最接近又剛好的、一則不同意見、一則跟寬度或材質有關的 */
function pickRepresentative(pool, footLengthCm, divergence, width, officialOffset) {
  const byDistance = [...pool].sort((a, b) => Math.abs(a.footLengthCm - footLengthCm) - Math.abs(b.footLengthCm - footLengthCm));
  const picked = [];
  const add = (r) => {
    if (r && !picked.includes(r) && picked.length < 3) picked.push(r);
  };
  add(byDistance.find((r) => r.fit === '剛好'));
  if (divergence) {
    add(byDistance.find((r) => Math.abs(r.offset - officialOffset) >= SETTINGS.disagreeGap));
    add(byDistance.find((r) => r.fit === '太大'));
  }
  if (width.level === 'strong' || width.level === 'mild') add(byDistance.find((r) => r.widthFeel === '偏窄' || r.widthFeel === '偏寬'));
  add(byDistance.find((r) => r.materialNote));
  add(byDistance.find((r) => r.fit !== '剛好'));
  for (const r of byDistance) add(r);
  return picked;
}
