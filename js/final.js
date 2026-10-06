/**
 * final.js — 綜合建議（首頁和 3D Lab 共用，保證兩邊永遠顯示同一個尺寸）
 *
 * 平台有兩種判斷方式：
 *   A. 買家回饋推薦（recommend.js）：品牌尺寸表 + 楦型偏移 + 腳長相近買家的實際結果
 *   B. 3D 鞋內空間模擬（fit3d.js）：腳和鞋內空間逐區比對 + 材質延展性
 *
 * 兩種方法各有盲點，所以我們不讓兩個頁面各說各話，而是用同一個規則合成「綜合建議」：
 *   1. 以 A 的建議尺寸為起點（它有真實買家的經驗，可信度隨信心分數提高）
 *   2. 用 B 檢查這個尺寸和前後各一號
 *   3. 每個候選尺寸的分數 = 3D 合腳分數（磨合後 60% + 剛買時 40%）+ 買家回饋加分
 *      買家回饋加分只給 A 建議的那一號，加分 = 10 + 信心分數 × 0.15（信心 74% → 加 21 分）
 *      但如果 3D 發現這一號本身就不太合腳，加分會打折：磨合後 ≥ 70 分全額、50–69 分 4 成、< 50 分不加
 *   4. 分數最高的就是綜合建議。只有在 3D 發現 A 的尺寸有明顯問題
 *      （例如腳趾頂到、腳跟會掉），而鄰近尺寸好很多時，才會改成鄰近尺寸，並說明原因。
 */
import { recommend, convertSize, stepOf, fmt } from './recommend.js';
import { footFromInput, simulateAll } from './fit3d.js';

export const FINAL_SETTINGS = {
  reviewBonusBase: 10,
  reviewBonusPerConfidence: 0.15,
};

const same = (a, b) => Math.abs(a - b) < 1e-6;
const labValue = (s) => s.scoreAfter * 0.6 + s.scoreInitial * 0.4;

/**
 * @param input { footLengthCm, footWidthCm, instepCm, gender }
 * @param data  { brands, models, charts, reviews, scans, materials }
 */
export function finalRecommendation(input, model, brand, data) {
  // A. 買家回饋推薦
  const review = recommend(input, model, brand, data.reviews, data.charts, data.models);

  // B. 3D 鞋內空間模擬（全部尺碼）
  const material = data.materials[model.materialKey];
  const foot = footFromInput(input);
  const lab = simulateAll(foot, model, data.scans[model.id], material);
  const sims = lab.sims;

  // 候選：A 的建議尺寸，以及前後各一號
  const step = stepOf(model);
  const baseIndex = sims.findIndex((s) => same(s.size, review.recommendedSize));
  const fullBonus = FINAL_SETTINGS.reviewBonusBase + review.confidence.score * FINAL_SETTINGS.reviewBonusPerConfidence;
  const baseAfter = baseIndex >= 0 ? sims[baseIndex].scoreAfter : 100;
  const bonus = fullBonus * (baseAfter >= 70 ? 1 : baseAfter >= 50 ? 0.4 : 0);

  let finalIndex = baseIndex;
  let adjusted = false;
  let reason = '';
  if (baseIndex >= 0) {
    const candidates = [baseIndex - 1, baseIndex, baseIndex + 1].filter((i) => i >= 0 && i < sims.length);
    const scoreOf = (i) => labValue(sims[i]) + (i === baseIndex ? bonus : 0);
    finalIndex = candidates.reduce((best, i) => (scoreOf(i) > scoreOf(best) ? i : best), baseIndex);
    if (finalIndex !== baseIndex) {
      adjusted = true;
      // 找出「換尺寸之後改善最多」的區域，當作調整的理由
      const base = sims[baseIndex];
      const next = sims[finalIndex];
      const bad = { 太緊: 3, 偏鬆: 2, 略緊: 1, 剛好: 0 };
      let problem = null;
      let gain = 0;
      base.zones.forEach((z, i) => {
        const g = bad[z.after] + bad[z.initial] * 0.5 - (bad[next.zones[i].after] + bad[next.zones[i].initial] * 0.5);
        if (g > gain) [problem, gain] = [z, g];
      });
      const sys = model.sizeSystem;
      const what = problem
        ? `${problem.name.replace(/（.*）/, '')}${problem.after === problem.initial ? problem.after : `剛買時${problem.initial}`}${problem.after !== '剛好' && problem.after === problem.initial ? '，磨合後也不會改善' : ''}`
        : '整體合腳度較差';
      reason = `買家回饋建議 ${sys} ${fmt(base.size)}，但 3D 模擬發現以你的腳型，這一號的${what}；${sys} ${fmt(next.size)} 整體更合腳，所以綜合建議改為 ${sys} ${fmt(next.size)}。`;
    }
  }
  const finalSim = finalIndex >= 0 ? sims[finalIndex] : null;
  const finalSize = finalSim ? finalSim.size : review.recommendedSize;

  // 3D 單獨看分數最高、但沒被選為綜合建議的尺寸（拿來當「第二意見」）
  let labAlt = null;
  if (finalSim && lab.bestIndex !== finalIndex && labValue(sims[lab.bestIndex]) > labValue(finalSim) + 5) {
    const alt = sims[lab.bestIndex];
    labAlt = {
      size: alt.size,
      text: `只看 3D 鞋內空間，${model.sizeSystem} ${fmt(alt.size)} 的合腳指數較高（磨合後 ${alt.scoreAfter}），但腳長相近的買家多數穿 ${model.sizeSystem} ${fmt(finalSize)}，所以綜合建議維持 ${model.sizeSystem} ${fmt(finalSize)}。`,
    };
  }

  return {
    review,
    lab,
    foot,
    material,
    finalSize,
    finalIndex,
    finalSim,
    adjusted,
    reason,
    labAlt,
    step,
    conversions: convertSize(finalSize, model, data.charts, input.gender),
  };
}
