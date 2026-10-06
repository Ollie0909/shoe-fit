/**
 * fit3d.js — 3D 試穿模擬的計算邏輯（只做計算，不碰畫面）
 *
 * 概念：把「你的腳」和「掃描到的鞋內空間」分成四個區域比對，再考慮材質：
 *   腳趾（長度）  鞋內長度 − 腳長 = 腳趾前方的空間。皮革長度方向不會撐開，磨合不會改善。
 *   前掌（寬度）  鞋內寬 − 腳寬。被壓到的地方，材質可以撐開一部分（麂皮多、馬臀皮幾乎不會）。
 *   腳背（高度）  鞋內高 − 腳背高。綁帶鞋可以用鞋帶調整；樂福鞋沒有鞋帶，太低會壓、太高會掉跟。
 *   腳跟（寬度）  鞋內寬 − 腳跟寬。鞋跟杯很硬、不會撐開；太寬就容易掉跟。
 * 每個區域會算「剛買時」和「磨合後」兩種狀態。
 *
 * 資料來源：data/scans.json（每個尺碼的鞋內尺寸）、data/materials.json（材質延展性）
 * 換成真實掃描或實測數據時，只需要替換這兩個 JSON。
 */

// ===== 可調整的參數（單位 mm）=====
export const LAB_SETTINGS = {
  // 沒填腳寬／腳背高時，用平均腳型估計：腳寬 = 腳長 × 0.39（女性 0.383）、腳背高 = 腳長 × 0.255
  defaultWidthRatio: 0.39,
  defaultWidthRatioW: 0.383,
  defaultInstepRatio: 0.255,
  // 腳跟寬 = 腳長 × 0.262，腳越寬、腳跟也稍微寬一點
  heelRatio: 0.262,

  // 腳趾前方空間：< 4 太緊、4–8 略緊、8–17 剛好（綁帶鞋到 19）、再多就偏鬆
  toe: { tight: 4, snug: 8, loose: 17, looseLaces: 19 },
  // 前掌寬度差：< -3 太緊、-3 ~ -1 略緊、-1 ~ 6 剛好（差 1 mm 以內皮革馬上就會服貼）、> 6 偏鬆
  ball: { tight: -3, snug: -1, loose: 6 },
  // 腳背：穿法可以提供的調整空間，以及「太鬆」的門檻
  instep: {
    tight: -2.5,
    snug: -1,
    relief: { laces: 3, strap: 1.5, elastic: 1, 'slip-on': 0 },
    loose: { laces: 9, strap: 6, elastic: 5, 'slip-on': 4 },
  },
  // 腳跟寬度差：腳跟稍微收窄是「包覆好」，窄超過 1.5 mm 才算略緊、超過 4 mm 才算太緊；
  // 寬超過門檻就容易掉跟（沒有鞋帶的鞋更敏感）
  heel: { tight: -4, snug: -1.5, loose: { laces: 4.5, strap: 4, elastic: 3.5, 'slip-on': 3 } },

  // 合腳指數的扣分。腳趾空間差越多扣越多（太長、太短都一樣），最多扣 70
  penalty: { 太緊: 35, 略緊: 12, 剛好: 0, 偏鬆: { toe: 22, ball: 10, instep: 12, heel: 22 }, toePerMm: 3, toeMax: 70 },
};

const S = LAB_SETTINGS;
const ZONE_NAMES = { toe: '腳趾（長度）', ball: '前掌（寬度）', instep: '腳背（高度）', heel: '腳跟（包覆）' };
const r1 = (n) => Math.round(n * 10) / 10;
const abs1 = (n) => r1(Math.abs(n));

/** 使用者輸入 → 腳的尺寸（mm）。沒填的用平均腳型估計並標記 */
export function footFromInput({ footLengthCm, footWidthCm, instepCm, gender }) {
  const length = footLengthCm * 10;
  const width = footWidthCm ? footWidthCm * 10 : length * (gender === '女' ? S.defaultWidthRatioW : S.defaultWidthRatio);
  const instep = instepCm ? instepCm * 10 : length * S.defaultInstepRatio;
  const heel = length * S.heelRatio + (width - length * S.defaultWidthRatio) * 0.3;
  return {
    lengthMm: length,
    ballWidthMm: width,
    instepMm: instep,
    heelWidthMm: heel,
    estimated: { width: !footWidthCm, instep: !instepCm },
  };
}

/** 依差距判斷狀態：太緊／略緊／剛好／偏鬆 */
function statusOf(diff, tight, snug, loose) {
  if (diff < tight) return '太緊';
  if (diff < snug) return '略緊';
  if (diff <= loose) return '剛好';
  return '偏鬆';
}

/** 材質撐開後的差距：被壓迫時，最多可撐開 allowance；撐到剛好就不會再變寬 */
function afterStretch(diff, allowance) {
  return diff < 0 ? Math.min(0, diff + allowance) : diff;
}

/**
 * 模擬某一個尺碼
 * @param foot     footFromInput() 的結果
 * @param scan     scans.json 中某個尺碼的資料
 * @param model    models.json 的鞋款（用到 closure 穿法）
 * @param material materials.json 的材質
 */
export function simulateSize(foot, scan, model, material) {
  const closure = model.closure || 'laces';
  const zones = [];

  // ── 腳趾：長度，材質不會改變 ──
  const toeGap = scan.lengthMm - foot.lengthMm;
  const toeLoose = closure === 'laces' ? S.toe.looseLaces : S.toe.loose;
  const toeStatus = toeGap < S.toe.tight ? '太緊' : toeGap < S.toe.snug ? '略緊' : toeGap <= toeLoose ? '剛好' : '偏鬆';
  zones.push({
    key: 'toe',
    diff: toeGap,
    initial: toeStatus,
    after: toeStatus,
    text:
      `腳趾前方還有 ${r1(toeGap)} mm（理想約 8–15 mm）。` +
      {
        太緊: '腳趾會頂到鞋頭；皮革的長度不會撐開，磨合後也不會改善。',
        略緊: '空間偏少，久走時腳趾可能碰到前端。',
        剛好: '長度剛好。',
        偏鬆: '前方空間太多，走路時腳會往前滑、後跟容易浮起。',
      }[toeStatus],
  });

  // ── 前掌：寬度，材質可以撐開 ──
  const ballDiff = scan.ballWidthMm - foot.ballWidthMm;
  const ballAllow = scan.ballWidthMm * material.stretchWidth;
  const ballAfter = afterStretch(ballDiff, ballAllow);
  const ballInit = statusOf(ballDiff, S.ball.tight, S.ball.snug, S.ball.loose);
  const ballEnd = statusOf(ballAfter, S.ball.tight, S.ball.snug, S.ball.loose);
  let ballText;
  if (ballDiff < 0) {
    ballText = `鞋內前掌比你的腳窄 ${abs1(ballDiff)} mm。${material.name}約可撐開 ${r1(ballAllow)} mm，`;
    ballText += ballAfter >= S.ball.snug ? `${material.breakIn}後會變剛好。` : `磨合後仍差 ${abs1(ballAfter)} mm，會持續壓腳。`;
  } else {
    ballText = `鞋內前掌比你的腳寬 ${r1(ballDiff)} mm，${ballInit === '偏鬆' ? '前掌會有空隙。' : '寬度合適。'}`;
  }
  zones.push({ key: 'ball', diff: ballDiff, initial: ballInit, after: ballEnd, text: ballText + (foot.estimated.width ? '（未填腳寬，用平均腳型估計）' : '') });

  // ── 腳背：高度，鞋帶可以調整，材質也可以撐開一點 ──
  const relief = S.instep.relief[closure] ?? 0;
  const instepLoose = S.instep.loose[closure] ?? 6;
  const instepRaw = scan.instepHeightMm - foot.instepMm;
  const instepDiff = instepRaw < 0 ? Math.min(0, instepRaw + relief) : instepRaw;
  const instepAllow = scan.instepHeightMm * material.stretchInstep;
  const instepAfter = afterStretch(instepDiff, instepAllow);
  const instepInit = statusOf(instepDiff, S.instep.tight, S.instep.snug, instepLoose);
  const instepEnd = statusOf(instepAfter, S.instep.tight, S.instep.snug, instepLoose);
  const closureNote = {
    laces: relief ? '綁帶鞋可以用鞋帶調整一些空間。' : '',
    strap: '扣帶可以微調。',
    elastic: '兩側鬆緊帶有一點彈性。',
    'slip-on': '樂福鞋沒有鞋帶，腳背太低會壓、太高會掉跟。',
  }[closure];
  let instepText = instepRaw < 0 ? `鞋內腳背處比你的腳背低 ${abs1(instepRaw)} mm。` : `鞋內腳背處比你的腳背高 ${r1(instepRaw)} mm。`;
  instepText += closureNote;
  if (instepDiff < S.instep.snug) instepText += instepAfter >= S.instep.snug ? `磨合後${material.name}會撐開到剛好。` : `磨合後仍會壓到腳背。`;
  else if (instepInit === '偏鬆') instepText += '腳背上方空間太多，可能需要鞋墊。';
  zones.push({ key: 'instep', diff: instepDiff, initial: instepInit, after: instepEnd, text: instepText + (foot.estimated.instep ? '（未填腳背高，用平均腳型估計）' : '') });

  // ── 腳跟：鞋跟杯很硬，不會因磨合改變 ──
  const heelDiff = scan.heelWidthMm - foot.heelWidthMm;
  const heelLoose = S.heel.loose[closure] ?? 4;
  const heelStatus = heelDiff < S.heel.tight ? '太緊' : heelDiff < S.heel.snug ? '略緊' : heelDiff <= heelLoose ? '剛好' : '偏鬆';
  zones.push({
    key: 'heel',
    diff: heelDiff,
    initial: heelStatus,
    after: heelStatus,
    text:
      heelDiff > heelLoose
        ? `腳跟處比你的腳寬 ${r1(heelDiff)} mm，走路容易掉跟；鞋跟杯很硬，磨合也不會改變。`
        : heelDiff < S.heel.snug
          ? `腳跟處比你的腳窄 ${abs1(heelDiff)} mm，後跟會比較緊，可能磨腳；鞋跟杯很硬，磨合改善有限。`
          : heelDiff < 0
            ? `腳跟處稍微收窄（${abs1(heelDiff)} mm），包覆好、走路不容易掉跟。`
            : `腳跟包覆剛好（多 ${r1(heelDiff)} mm）。`,
  });

  zones.forEach((z) => (z.name = ZONE_NAMES[z.key]));

  // 腳趾的扣分依「離理想範圍多遠」加重
  const toeExtra = toeGap < S.toe.snug ? (S.toe.snug - toeGap) * S.penalty.toePerMm : toeGap > toeLoose ? (toeGap - toeLoose) * S.penalty.toePerMm : 0;
  const scoreOf = (mode) =>
    Math.round(
      Math.max(
        0,
        100 -
          zones.reduce((sum, z) => {
            const st = z[mode];
            if (z.key === 'toe') return sum + Math.min(S.penalty.toeMax, (st === '偏鬆' ? S.penalty.偏鬆.toe : S.penalty[st]) + toeExtra);
            return sum + (st === '偏鬆' ? S.penalty.偏鬆[z.key] : S.penalty[st]);
          }, 0),
      ),
    );

  // 磨合後需要多久（只有前掌或腳背會因材質改善時才顯示）
  const improves = zones.some((z) => z.initial !== z.after);

  return {
    size: scan.size,
    scan,
    zones,
    scoreInitial: scoreOf('initial'),
    scoreAfter: scoreOf('after'),
    improves,
    allowance: { ball: ballAllow, instep: instepAllow },
  };
}

/** 合腳指數的文字等級 */
export function scoreLabel(score) {
  if (score >= 85) return '很合腳';
  if (score >= 70) return '可以穿';
  if (score >= 50) return '勉強可穿';
  return '不太適合你的腳型';
}

/**
 * 模擬全部尺碼，挑出最合腳的一號
 * 排序依據：磨合後 60% + 剛買時 40%（太痛的鞋，很多人撐不到磨合完）
 */
export function simulateAll(foot, model, scanEntry, material) {
  const sims = scanEntry.sizes.map((s) => simulateSize(foot, s, model, material));
  const value = (x) => x.scoreAfter * 0.6 + x.scoreInitial * 0.4 - Math.abs(x.zones[0].diff - 11) * 0.01;
  let bestIndex = 0;
  sims.forEach((x, i) => {
    if (value(x) > value(sims[bestIndex])) bestIndex = i;
  });
  return { sims, bestIndex, best: sims[bestIndex] };
}

/** 一句話總結：最需要注意的地方 */
export function summarize(sim, material, system) {
  const label = `${system} ${sim.size}`;
  const z = Object.fromEntries(sim.zones.map((x) => [x.key, x]));
  if (z.toe.initial === '太緊') return `${label} 長度不夠，腳趾會頂到；材質撐開也無法改善長度，建議換大一號。`;
  if (z.heel.after === '偏鬆') return `${label} 的腳跟偏寬，走路容易掉跟，磨合也不會改善。`;
  if (sim.improves && sim.scoreAfter > sim.scoreInitial) {
    const still = sim.zones.find((x) => x.after !== '剛好');
    return still
      ? `${label} 剛穿時會有點緊，${material.name}${material.breakIn}後會改善，但${still.name.replace(/（.*）/, '')}仍${still.after}。`
      : `${label} 剛穿時會有點緊，${material.name}${material.breakIn}後會明顯服貼。`;
  }
  if (sim.zones.every((x) => x.after === '剛好')) return `${label} 四個區域都剛好。`;
  const worst = sim.zones.find((x) => x.after === '太緊') || sim.zones.find((x) => x.after === '偏鬆') || sim.zones.find((x) => x.after === '略緊');
  return worst ? `${label} 整體合腳，主要留意${worst.name.replace(/（.*）/, '')}：${worst.after}。` : `${label} 整體合腳。`;
}
