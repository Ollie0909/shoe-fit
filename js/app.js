/**
 * app.js — 首頁（尺寸建議）的畫面與互動
 * 流程：01 量腳 → 02 選鞋 → 03 建議。
 * 建議尺寸來自 final.js 的「綜合建議」（買家回饋 + 3D 鞋內空間），和 3D Lab 頁面用同一個函式，所以兩邊永遠一致。
 */
import { fmt, RELIABILITY_LABELS, SYSTEM_LABELS } from './recommend.js';
import { finalRecommendation } from './final.js';
import { scoreLabel } from './fit3d.js';
import { openFootScan } from './footscan.js';
import { loadAll } from './data.js';
import { loadProfile, saveProfile } from './store.js';
import { createPicker, shoeArt } from './picker.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const els = {
  footForm: $('#foot-form'),
  length: $('#foot-length'),
  width: $('#foot-width'),
  instep: $('#foot-instep'),
  footError: $('#foot-error'),
  footChip: $('#foot-chip'),
  result: $('#screen-result'),
  ctaBar: $('#cta-bar'),
  ctaSel: $('#cta-sel'),
  ctaBtn: $('#cta-btn'),
  toast: $('#toast'),
  loadError: $('#load-error'),
};

let data;
let picker;
let foot = null; // { footLengthCm, footWidthCm, instepCm, gender }
let lastResult = null;

// ===== 啟動 =====
async function init() {
  try {
    const d = await loadAll(['brands', 'models', 'size-charts', 'reviews', 'site', 'scans', 'materials']);
    data = {
      brands: [...d.brands].sort((a, b) => a.order - b.order),
      models: d.models,
      charts: d['size-charts'],
      reviews: d.reviews.reviews,
      site: d.site,
      scans: d.scans.scans,
      materials: d.materials.materials,
    };
  } catch (err) {
    els.loadError.hidden = false;
    els.loadError.textContent = `資料載入失敗：${err.message}。如果你是直接雙擊打開 index.html，請改用 README 說明的方式啟動本機伺服器。`;
    return;
  }

  // 網址參數（分享連結）優先，其次是上次在這支手機輸入的資料
  const params = new URLSearchParams(location.search);
  const saved = loadProfile();
  const len = params.get('len') || saved.len || '';
  const wid = params.get('w') || (params.get('len') ? '' : saved.w) || '';
  const gender = params.get('g') || saved.g || '男';
  els.length.value = len;
  els.width.value = wid;
  els.instep.value = params.get('instep') || (params.get('len') ? '' : saved.instep) || '';
  document.querySelector(`input[name="g"][value="${gender}"]`).checked = true;

  picker = createPicker($('#picker'), {
    brands: data.brands,
    models: data.models,
    gender,
    brandId: params.get('brand') || saved.brand || data.brands[0].id,
    modelId: params.get('model') || null,
    onChange: updateCta,
  });

  bindEvents();

  if (params.get('len') && params.get('model') && readFoot(false)) {
    showResult({ push: false });
  } else {
    show('foot', { push: false });
  }
}

// ===== 畫面切換 =====
function show(name, { push = true } = {}) {
  document.querySelectorAll('[data-screen]').forEach((s) => (s.hidden = s.dataset.screen !== name));
  els.ctaBar.hidden = name !== 'shoe';
  const order = ['foot', 'shoe', 'result'];
  document.querySelectorAll('.progress li').forEach((li, i) => {
    const idx = order.indexOf(name);
    li.classList.toggle('is-current', i === idx);
    li.classList.toggle('is-done', i < idx);
    const btn = li.querySelector('button');
    btn.disabled = !(i === 0 || (i === 1 && foot) || (i === 2 && lastResult));
    if (i === idx) btn.setAttribute('aria-current', 'step');
    else btn.removeAttribute('aria-current');
  });
  if (name === 'shoe') updateFootChip();
  const url = `${location.pathname}${location.search}#${name}`;
  if (push) history.pushState({ screen: name }, '', url);
  else history.replaceState({ screen: name }, '', url);
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => {
  const name = location.hash.slice(1);
  if (name === 'result' && lastResult) show('result', { push: false });
  else if (name === 'shoe' && foot) show('shoe', { push: false });
  else show('foot', { push: false });
});

function bindEvents() {
  els.footForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (readFoot(true)) show('shoe');
  });
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (!go || go.disabled) return;
    if (go.dataset.goto === 'shoe' && !readFoot(true)) return show('foot');
    show(go.dataset.goto);
  });
  document.querySelectorAll('input[name="g"]').forEach((r) =>
    r.addEventListener('change', () => {
      saveProfile({ g: r.value });
      if (foot) foot.gender = r.value;
      picker.setGender(r.value);
    }),
  );
  els.ctaBtn.addEventListener('click', () => showResult({ push: true }));
  // 用手機拍照量腳：量完自動帶入腳長、腳寬
  document.querySelectorAll('[data-footscan]').forEach((btn) =>
    btn.addEventListener('click', () =>
      openFootScan((r) => {
        els.length.value = r.lengthCm.toFixed(1);
        els.width.value = r.widthCm.toFixed(1);
        readFoot(false);
        showToast(`已帶入：腳長 ${r.lengthCm.toFixed(1)} cm、腳寬 ${r.widthCm.toFixed(1)} cm`);
      }),
    ),
  );
}

function updateCta(model) {
  els.ctaBtn.disabled = !model;
  els.ctaSel.innerHTML = model ? `已選<b>${esc(model.name)}</b>` : '請選擇一雙鞋';
}

function updateFootChip() {
  if (!foot) return;
  els.footChip.textContent = `腳長 ${fmt(foot.footLengthCm)}${foot.footWidthCm ? `・寬 ${fmt(foot.footWidthCm)}` : ''}${foot.instepCm ? `・背高 ${fmt(foot.instepCm)}` : ''} cm　修改`;
}

// ===== 讀取與驗證腳型 =====
function readFoot(showErrors) {
  const len = parseFloat(els.length.value);
  const widRaw = els.width.value.trim();
  const wid = widRaw ? parseFloat(widRaw) : null;
  const insRaw = els.instep.value.trim();
  const ins = insRaw ? parseFloat(insRaw) : null;
  let error = null;
  let field = null;
  if (!len || len < 18 || len > 33) [error, field] = ['請輸入 18–33 cm 之間的腳長（例如 25.5）。', els.length];
  else if (wid !== null && (Number.isNaN(wid) || wid < 6 || wid > 14)) [error, field] = ['腳寬請輸入 6–14 cm，或留空。', els.width];
  else if (wid !== null && (wid / len < 0.3 || wid / len > 0.5)) [error, field] = ['腳寬和腳長的比例不太合理，請再確認一次。', els.width];
  else if (ins !== null && (Number.isNaN(ins) || ins < 4 || ins > 10)) [error, field] = ['腳背高請輸入 4–10 cm，或留空。', els.instep];

  [els.length, els.width, els.instep].forEach((el) => el.removeAttribute('aria-invalid'));
  if (error) {
    if (showErrors) {
      els.footError.hidden = false;
      els.footError.textContent = error;
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }
    return false;
  }
  els.footError.hidden = true;
  foot = {
    footLengthCm: Math.round(len * 10) / 10,
    footWidthCm: wid ? Math.round(wid * 10) / 10 : null,
    instepCm: ins ? Math.round(ins * 10) / 10 : null,
    gender: document.querySelector('input[name="g"]:checked').value,
  };
  saveProfile({ len: foot.footLengthCm, w: foot.footWidthCm || '', instep: foot.instepCm || '', g: foot.gender });
  return true;
}

// ===== 計算並顯示結果 =====
function showResult({ push }) {
  const model = picker.selected();
  if (!model || !foot) return show(foot ? 'shoe' : 'foot', { push: false });
  const brand = data.brands.find((b) => b.id === model.brandId);
  // 綜合建議（和 3D Lab 用同一個函式）
  const f = finalRecommendation(foot, model, brand, data);
  const steps = [...f.review.steps];
  if (f.finalSim) {
    steps.push(
      f.adjusted
        ? `3D 鞋內空間檢查：${f.reason}`
        : `3D 鞋內空間檢查：${model.sizeSystem} ${fmt(f.finalSize)} 剛買時合腳指數 ${f.finalSim.scoreInitial}、磨合後 ${f.finalSim.scoreAfter}，確認可以穿。`,
    );
  }
  lastResult = { ...f.review, recommendedSize: f.finalSize, conversions: f.conversions, steps, final: f };
  saveProfile({ brand: brand.id });

  const params = new URLSearchParams({ len: foot.footLengthCm, g: foot.gender, brand: brand.id, model: model.id });
  if (foot.footWidthCm) params.set('w', foot.footWidthCm);
  if (foot.instepCm) params.set('instep', foot.instepCm);
  history.replaceState(history.state, '', `?${params}${location.hash}`);

  els.result.innerHTML = renderResult(lastResult, foot, params);
  bindResultEvents(lastResult, params);
  show('result', { push });
}

/** 結果頁最上方那一句「最重要的話」 */
function keyInsight(r) {
  const { system: sys, model } = r;
  if (r.notices.length) return { tone: 'alert', text: r.notices[0] };
  if (r.final && r.final.adjusted) return { tone: 'warn', text: r.final.reason };
  if (r.width.level === 'strong') {
    return {
      tone: 'alert',
      text: model.halfSizes
        ? `你的腳偏寬、這雙楦頭偏窄：可以考慮加半號（${sys} ${fmt(r.width.altSize)}），或改看楦頭較寬的款式。`
        : `你的腳偏寬、這雙楦頭偏窄，而且沒有半號：建議先看看楦頭較寬的款式。`,
    };
  }
  if (r.divergence) {
    const d = r.divergence;
    const pct = Math.round(((d.direction > 0 ? d.bigger : d.smaller) / d.n) * 100);
    return {
      tone: 'warn',
      text:
        d.direction > 0
          ? `官方與買家說法不一：相近買家有 ${pct}% 最後選了更大的尺寸。建議 ${sys} ${fmt(r.recommendedSize)}；腳背較高可考慮 ${sys} ${fmt(d.altSize)}。`
          : `官方與買家說法不一：相近買家有 ${pct}% 最後選了更小的尺寸。建議 ${sys} ${fmt(r.recommendedSize)}；腳型偏瘦可考慮 ${sys} ${fmt(d.altSize)}。`,
    };
  }
  if (r.neighborMatch.n >= 3) {
    return { tone: 'ok', text: `腳長和你相近的 ${r.neighborMatch.n} 位買家中，${Math.round(r.neighborMatch.share * 100)}% 最後合腳的就是這個尺寸。` };
  }
  return { tone: 'ok', text: `依${r.standard.official ? '品牌官方腳長對照表' : '標準量腳尺寸'}與這款的尺寸偏移計算；相近的回饋還不多，下單前建議再對照官方尺寸表。` };
}

function renderResult(r, input, params) {
  const { model, brand, system: sys, conversions: cv, confidence: conf } = r;
  const insight = keyInsight(r);
  const yourUs = input.gender === '女' ? `US 女 ${fmt(r.yourSizes.usW)}` : `US 男 ${fmt(r.yourSizes.usM)}`;

  return `
    <article class="hero">
      <div class="hero-art">${shoeArt(model)}</div>
      <p class="eyebrow">你的建議尺寸</p>
      <p class="hero-model">${esc(brand.name)}<span>${esc(model.name)}</span></p>
      <p class="size-big"><small>${sys}</small>${fmt(r.recommendedSize)}</p>
      <p class="hero-system">${SYSTEM_LABELS[sys]}・${model.halfSizes ? '有半號' : '只有整數號'}${sys === 'IT' ? '・數字像 EU，但尺寸不同' : ''}</p>
      <dl class="conversions">
        <div><dt>${esc(cv.usLabel)}</dt><dd>${fmt(cv.us)}</dd></div>
        <div><dt>UK</dt><dd>${fmt(cv.uk)}</dd></div>
        <div><dt>EU</dt><dd>${fmt(cv.eu)}</dd></div>
      </dl>
      <div class="hero-foot">
        <span class="conf-pill conf-${conf.level}">信心${conf.level}・${conf.score}%</span>
        <span class="hero-basis">${r.neighbors ? `參考 ${r.neighbors} 則相近回饋` : '尚無相近回饋'}</span>
      </div>
      ${r.final && r.final.finalSim ? `<a class="hero-3d" href="lab/?${params}">
        <span class="hero-3d-k">3D 鞋內空間檢查</span>
        <span class="hero-3d-v">剛買時 <b>${r.final.finalSim.scoreInitial}</b>・磨合後 <b>${r.final.finalSim.scoreAfter}</b>　${scoreLabel(r.final.finalSim.scoreAfter)}</span>
        <span class="hero-3d-a" aria-hidden="true">→</span>
      </a>` : ''}
    </article>

    <p class="insight insight-${insight.tone}">${esc(insight.text)}</p>

    ${renderAlerts(r)}

    <div class="acc-group">
      <details class="acc">
        <summary><span>為什麼是 ${sys} ${fmt(r.recommendedSize)}？</span><small>計算過程與信心</small></summary>
        <div class="acc-body">
          <p class="muted">你的一般標準尺寸約 ${yourUs}・UK ${fmt(r.yourSizes.uk)}・EU ${fmt(r.yourSizes.eu)}</p>
          <ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          <h4 class="sub">信心 ${conf.score}% 的來源</h4>
          <div class="meter"><span style="width:${conf.score}%"></span></div>
          <ul class="conf-parts">
            ${conf.parts.map((p) => `<li><span>${esc(p.label)}</span><span class="pts">${Math.round(p.score)}<small> / ${p.max}</small></span><span class="detail">${esc(p.detail)}</span></li>`).join('')}
          </ul>
        </div>
      </details>

      <details class="acc">
        <summary><span>買家怎麼說</span><small>${r.insights.total} 則回饋・<span class="tag tag-sim">模擬</span></small></summary>
        <div class="acc-body">${renderInsights(r.insights)}${renderReviews(r.representative)}</div>
      </details>

      <details class="acc">
        <summary><span>楦頭、寬度與材質</span><small>${r.width.level === 'mild' ? '有一則寬度提醒・' : ''}${esc(model.toeWidth)}楦・${esc(model.material)}</small></summary>
        <div class="acc-body">${renderFit(r)}</div>
      </details>

      <details class="acc">
        <summary><span>官方／零售商資訊</span><small><span class="tag tag-${model.reliability}">${RELIABILITY_LABELS[model.reliability]}</span></small></summary>
        <div class="acc-body">
          <p>${esc(model.officialNote)}</p>
          <dl class="spec">
            <div><dt>來源</dt><dd>${esc(model.source)}</dd></div>
            <div><dt>楦型</dt><dd>${esc(model.last)}</dd></div>
            <div><dt>預設偏移</dt><dd>${fmt(model.sizeOffset)} 號</dd></div>
            <div><dt>尺寸表</dt><dd>${esc(r.standard.chartName)}</dd></div>
          </dl>
          ${model.imageCredit ? `<p class="img-credit">商品照片來源：${esc(model.imageCredit)}${model.imageNote ? `。${esc(model.imageNote)}` : ''}</p>` : ''}
        </div>
      </details>
    </div>

    <div class="actions">
      <button type="button" class="btn-primary" id="share-btn">分享這個結果</button>
      <a class="btn-outline" id="feedback-btn" href="${esc(data.site.feedbackFormUrl || '#')}" ${data.site.feedbackFormUrl ? 'target="_blank" rel="noopener"' : ''}>回報你的穿著經驗</a>
    </div>

    <a class="lab-promo" href="lab/?${params}">
      <span class="lab-promo-k">3D 試穿 Lab</span>
      <span class="lab-promo-t">看看這雙鞋穿起來，哪裡會緊、磨合後會不會改善</span>
      <span class="lab-promo-arrow" aria-hidden="true">→</span>
    </a>

    <div class="links-row">
      <button type="button" class="link-btn" data-goto="shoe">換一雙看看</button>
      <button type="button" class="link-btn" data-goto="foot">重新量腳</button>
    </div>
  `;
}

function renderAlerts(r) {
  let html = '';
  const w = r.width;
  if (w.level === 'strong') {
    const sugg = w.suggestions && w.suggestions.length
      ? `<div class="suggest"><p>楦頭較寬、可以考慮：</p><div class="suggest-list">${w.suggestions
          .map((m) => `<div class="suggest-item"><span class="suggest-art">${shoeArt(m)}</span><span>${esc(brandName(m.brandId))}<b>${esc(m.name)}</b></span></div>`)
          .join('')}</div></div>`
      : '';
    html += `<div class="alert alert-${w.level}"><h3>${esc(w.title)}</h3><p>${esc(w.message)}</p>${w.peerText ? `<p class="muted-in">${esc(w.peerText)}</p>` : ''}${sugg}</div>`;
  }
  const d = r.divergence;
  if (d) {
    html += `<div class="alert alert-mild">
      <h3>官方說法與買家回饋不一致</h3>
      <div class="diverge-grid">
        <div><h4>官方／零售商</h4><p>${esc(d.official)}</p></div>
        <div><h4>買家回饋 <span class="tag tag-sim">模擬</span></h4><p>${esc(d.buyers)}</p></div>
      </div>
      <p class="muted-in">${esc(d.why)}</p>
    </div>`;
  }
  return html;
}

function renderInsights(ins) {
  if (!ins.total) return '<p class="muted">這款目前沒有回饋。</p>';
  const maxShare = Math.max(...ins.distribution.map((d) => d.share));
  const pct = (x) => `${Math.round((x / ins.total) * 100)}%`;
  return `
    <p class="headline">${esc(ins.headline)}</p>
    <p class="muted">每位買家「最後合腳的尺寸」比自己的標準尺寸大或小多少：</p>
    <div class="bars">${ins.distribution
      .map(
        (d) => `<div class="bar${d.share === maxShare ? ' top' : ''}"><span>${esc(d.label)}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.round(d.share * 100)}%"></span></span><span class="pct">${Math.round(d.share * 100)}%</span></div>`,
      )
      .join('')}</div>
    <p class="muted small">${esc(ins.tendency)} 當初購買的結果：剛好 ${pct(ins.fitCounts['剛好'])}・太小 ${pct(ins.fitCounts['太小'])}・太大 ${pct(ins.fitCounts['太大'])}</p>`;
}

function renderReviews(list) {
  if (!list.length) return '';
  return `
    <h4 class="sub">代表性回饋 <span class="tag tag-sim">模擬評論（demo 用）</span></h4>
    <p class="muted small">以下由程式依尺寸傾向模擬產生，不是真人撰寫。</p>
    ${list
      .map((rv) => {
        const meta = [`${rv.gender}性`, `腳長 ${fmt(rv.footLengthCm)}`, rv.footWidthCm ? `寬 ${fmt(rv.footWidthCm)}` : null, `平時 ${rv.usualSize}`, `購買 ${rv.sizeSystem} ${fmt(rv.purchasedSize)}`].filter(Boolean);
        return `<article class="review"><div class="review-meta"><span class="fit-pill fit-${rv.fit}">${rv.fit}</span>${meta.map((t) => `<span>${esc(t)}</span>`).join('')}</div><p>${esc(rv.text)}</p></article>`;
      })
      .join('')}`;
}

function renderFit(r) {
  const ins = r.insights;
  const wc = ins.widthCounts;
  const pct = (x) => `${Math.round((x / ins.total) * 100)}%`;
  const w = r.width;
  const widthLine =
    w.level === 'strong'
      ? ''
      : `<li><span class="k">${w.level === 'mild' ? `<span class="tag tag-unverified">留意</span> ${esc(w.title)}` : '你的腳寬'}</span>${esc(w.message)}${w.peerText ? `<br><span class="muted small">${esc(w.peerText)}</span>` : ''}</li>`;
  return `<ul class="facts">
    ${widthLine}
    <li><span class="k">楦頭</span>${esc(ins.toe)}${ins.total ? `<br><span class="muted small">買家感受：偏窄 ${pct(wc['偏窄'])}・剛好 ${pct(wc['剛好'])}・偏寬 ${pct(wc['偏寬'])}</span>` : ''}</li>
    <li><span class="k">材質</span>${esc(ins.material)}</li>
  </ul>`;
}

function bindResultEvents(r, params) {
  $('#share-btn').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?${params}`;
    const text = `${r.brand.name} ${r.model.name}：建議 ${r.system} ${fmt(r.recommendedSize)}（信心${r.confidence.level}）`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'FIT ATELIER 尺寸建議', text, url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        showToast('已複製連結，可以貼到 LINE 分享');
      }
    } catch {
      // 使用者取消分享，不用處理
    }
  });
  if (!data.site.feedbackFormUrl) {
    $('#feedback-btn').addEventListener('click', (e) => {
      e.preventDefault();
      showToast('回報表單準備中，敬請期待');
    });
  }
}

// ===== 小工具 =====
function brandName(id) {
  return data.brands.find((b) => b.id === id)?.name || id;
}

let toastTimer;
function showToast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 2600);
}

init();
