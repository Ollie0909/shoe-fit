/**
 * lab.js — 3D 試穿 Lab 頁面的畫面與互動
 * 計算在 fit3d.js，3D 畫面在 viewer3d.js，這裡負責把它們串起來。
 * 「建議尺寸」來自 final.js 的綜合建議，和首頁用同一個函式，所以兩邊永遠一致。
 */
import { loadAll } from './data.js';
import { loadProfile, saveProfile } from './store.js';
import { createPicker } from './picker.js';
import { scoreLabel, summarize } from './fit3d.js';
import { finalRecommendation } from './final.js';
import { openFootScan } from './footscan.js';
import { createViewer } from './viewer3d.js';
import { fmt, SYSTEM_LABELS } from './recommend.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const els = {
  length: $('#lab-length'),
  width: $('#lab-width'),
  instep: $('#lab-instep'),
  error: $('#lab-error'),
  run: $('#run-btn'),
  results: $('#lab-results'),
  viewer: $('#viewer'),
  sizeTabs: $('#size-tabs'),
  summary: $('#lab-summary'),
  zones: $('#zones'),
  material: $('#material-card'),
  toSize: $('#to-size'),
  afterLabel: $('#after-label'),
};

let data;
let picker;
let viewerPromise = null;
const state = { foot: null, input: null, model: null, sim: null, index: 0, mode: 'initial' };

async function init() {
  try {
    const d = await loadAll(['brands', 'models', 'size-charts', 'reviews', 'scans', 'materials']);
    data = {
      brands: [...d.brands].sort((a, b) => a.order - b.order),
      models: d.models,
      charts: d['size-charts'],
      reviews: d.reviews.reviews,
      scans: d.scans.scans,
      materials: d.materials.materials,
    };
  } catch (err) {
    els.run.textContent = `資料載入失敗：${err.message}`;
    return;
  }

  const params = new URLSearchParams(location.search);
  const saved = loadProfile();
  els.length.value = params.get('len') || saved.len || '';
  els.width.value = params.get('w') || (params.get('len') ? '' : saved.w) || '';
  els.instep.value = params.get('instep') || saved.instep || '';
  const gender = params.get('g') || saved.g || '男';
  document.querySelector(`input[name="g"][value="${gender}"]`).checked = true;

  picker = createPicker($('#picker'), {
    brands: data.brands,
    models: data.models,
    gender,
    brandId: params.get('brand') || saved.brand || data.brands[0].id,
    modelId: params.get('model') || null,
    assetBase: '../',
    onChange: (m) => (els.run.disabled = !m),
  });
  els.run.disabled = !picker.selected();

  document.querySelectorAll('input[name="g"]').forEach((r) =>
    r.addEventListener('change', () => {
      saveProfile({ g: r.value });
      picker.setGender(r.value);
    }),
  );
  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', () => {
      state.mode = r.value;
      renderSize();
    }),
  );
  els.run.addEventListener('click', () => run(true));
  // 用手機拍照量腳：量完自動帶入腳長、腳寬
  document.querySelectorAll('[data-footscan]').forEach((btn) =>
    btn.addEventListener('click', () =>
      openFootScan((r) => {
        els.length.value = r.lengthCm.toFixed(1);
        els.width.value = r.widthCm.toFixed(1);
        saveProfile({ len: r.lengthCm, w: r.widthCm });
        showToast(`已帶入：腳長 ${r.lengthCm.toFixed(1)} cm、腳寬 ${r.widthCm.toFixed(1)} cm`);
      }),
    ),
  );
  els.sizeTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-index]');
    if (!btn) return;
    state.index = +btn.dataset.index;
    renderSize();
  });

  if (params.get('len') && params.get('model') && picker.selected()) run(false);
}

function readInput() {
  const len = parseFloat(els.length.value);
  const wid = els.width.value.trim() ? parseFloat(els.width.value) : null;
  const ins = els.instep.value.trim() ? parseFloat(els.instep.value) : null;
  if (!len || len < 18 || len > 33) return { error: '請輸入 18–33 cm 之間的腳長。', field: els.length };
  if (wid !== null && (Number.isNaN(wid) || wid / len < 0.3 || wid / len > 0.5)) return { error: '腳寬的數字不太合理，請再確認一次。', field: els.width };
  if (ins !== null && (Number.isNaN(ins) || ins < 4 || ins > 10)) return { error: '腳背高請輸入 4–10 cm，或留空。', field: els.instep };
  return { footLengthCm: Math.round(len * 10) / 10, footWidthCm: wid, instepCm: ins };
}

function run(scroll) {
  const input = readInput();
  [els.length, els.width, els.instep].forEach((el) => el.removeAttribute('aria-invalid'));
  if (input.error) {
    els.error.hidden = false;
    els.error.textContent = input.error;
    input.field.setAttribute('aria-invalid', 'true');
    input.field.scrollIntoView({ block: 'center' });
    return;
  }
  els.error.hidden = true;
  const model = picker.selected();
  if (!model) return;
  const gender = document.querySelector('input[name="g"]:checked').value;
  saveProfile({ len: input.footLengthCm, w: input.footWidthCm || '', instep: input.instepCm || '', g: gender, brand: model.brandId });

  // 綜合建議（和首頁用同一個函式）
  const brand = data.brands.find((b) => b.id === model.brandId);
  const f = finalRecommendation({ ...input, gender }, model, brand, data);
  state.input = input;
  state.final = f;
  state.foot = f.foot;
  state.model = model;
  state.material = f.material;
  state.sim = f.lab;
  state.index = f.finalIndex >= 0 ? f.finalIndex : f.lab.bestIndex;
  state.mode = 'initial';
  document.querySelector('input[name="mode"][value="initial"]').checked = true;

  const params = new URLSearchParams({ len: input.footLengthCm, g: gender, brand: model.brandId, model: model.id });
  if (input.footWidthCm) params.set('w', input.footWidthCm);
  if (input.instepCm) params.set('instep', input.instepCm);
  history.replaceState(null, '', `?${params}`);
  els.toSize.href = `../?${params}#result`;

  els.results.hidden = false;
  if (!viewerPromise) viewerPromise = createViewer(els.viewer);
  renderMaterial();
  renderSize();
  if (scroll) els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 尺碼分頁：最合腳的一號，加上前後各一號 */
function renderTabs() {
  const { sims } = state.sim;
  const bestIndex = state.final.finalIndex >= 0 ? state.final.finalIndex : state.sim.bestIndex;
  const from = Math.max(0, Math.min(bestIndex - 1, sims.length - 3));
  const idx = sims.slice(from, from + 3).map((_, i) => from + i);
  els.sizeTabs.style.setProperty('--n', idx.length);
  els.sizeTabs.dataset.indexes = idx.join(',');
  els.sizeTabs.innerHTML = idx
    .map((i) => {
      const s = sims[i];
      return `<button type="button" class="size-tab" data-index="${i}">
        ${i === bestIndex ? '<span class="best">綜合建議</span>' : '<span class="best">&nbsp;</span>'}
        <b>${state.model.sizeSystem} ${fmt(s.size)}</b>
        <small>合腳指數 ${state.mode === 'after' ? s.scoreAfter : s.scoreInitial}</small>
      </button>`;
    })
    .join('');
}

function renderSize() {
  const sim = state.sim.sims[state.index];
  const mode = state.mode;
  const sys = state.model.sizeSystem;
  renderTabs();
  els.sizeTabs.querySelectorAll('.size-tab').forEach((b) => b.classList.toggle('is-on', +b.dataset.index === state.index));

  // 磨合後：被壓迫的地方依材質撐開，鞋內空間跟著變大
  const scan = sim.scan;
  const z = Object.fromEntries(sim.zones.map((x) => [x.key, x]));
  const interior =
    mode === 'after'
      ? {
          ...scan,
          ballWidthMm: scan.ballWidthMm + (z.ball.diff < 0 ? Math.min(sim.allowance.ball, -z.ball.diff) : 0),
          instepHeightMm: scan.instepHeightMm + (z.instep.diff < 0 ? Math.min(sim.allowance.instep, -z.instep.diff) : 0),
        }
      : scan;
  const statuses = Object.fromEntries(sim.zones.map((x) => [x.key, x[mode]]));
  viewerPromise.then((v) => v && v.show({ foot: state.foot, interior, model: state.model, statuses }));

  const score = mode === 'after' ? sim.scoreAfter : sim.scoreInitial;
  const isBest = state.index === state.final.finalIndex;
  const f = state.final;
  const note = isBest ? (f.adjusted ? f.reason : f.labAlt ? f.labAlt.text : '這個尺寸和「尺寸建議」頁面的結果相同：買家回饋與 3D 鞋內空間的判斷一致。') : '';
  els.summary.innerHTML = `
    <div class="lab-summary">
      <div class="score-ring" style="--p:${score}"><div><span><b>${score}</b><br><small>合腳指數</small></span></div></div>
      <div>
        <p class="eyebrow" style="color:var(--gold)">${isBest ? '綜合建議' : '比較中'}・${mode === 'after' ? '磨合後' : '剛買時'}</p>
        <h2>${sys} ${fmt(sim.size)}　${scoreLabel(sim.scoreAfter)}</h2>
        <p>${esc(summarize(sim, state.material, sys))}</p>
      </div>
    </div>
    <p class="muted small" style="margin:12px 0 0">剛買時 ${sim.scoreInitial} 分 → 磨合後 ${sim.scoreAfter} 分・${SYSTEM_LABELS[sys]}</p>
    ${note ? `<p class="agree-note">${esc(note)}</p>` : ''}`;

  els.zones.innerHTML = sim.zones
    .map(
      (x) => `<li class="zone">
        <div class="zone-head">
          <span class="zone-name">${esc(x.name)}</span>
          <span class="zone-pills">
            <span class="zpill zpill-${x.initial}">${x.initial}</span>
            ${x.after !== x.initial ? `→ <span class="zpill zpill-${x.after}">${x.after}</span>` : ''}
          </span>
        </div>
        <p>${esc(x.text)}</p>
      </li>`,
    )
    .join('');
}

function renderMaterial() {
  const m = state.material;
  els.afterLabel.textContent = `磨合後（${m.breakIn}）`;
  els.material.innerHTML = `
    <h3 class="lab-section-title">材質：${esc(m.name)} <span class="tag tag-sim">估計值</span></h3>
    <dl class="spec">
      <div><dt>寬度可撐開</dt><dd>約 ${Math.round(m.stretchWidth * 1000) / 10}%</dd></div>
      <div><dt>腳背可撐開</dt><dd>約 ${Math.round(m.stretchInstep * 1000) / 10}%</dd></div>
      <div><dt>磨合時間</dt><dd>${esc(m.breakIn)}</dd></div>
      <div><dt>穿法</dt><dd>${{ laces: '綁帶', 'slip-on': '套入（無鞋帶）', elastic: '兩側鬆緊帶', strap: '扣帶' }[state.model.closure]}</dd></div>
    </dl>
    <p class="muted small" style="margin:12px 0 0">${esc(m.note)}皮革主要在寬度和腳背方向撐開，<b>長度幾乎不會變</b>，所以太短的鞋不會因為磨合而變合腳。</p>`;
}

let toastTimer;
function showToast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

init();
