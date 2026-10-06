/**
 * picker.js — 品牌卡片＋鞋款插畫卡片的選擇器（首頁和 Lab 頁共用）
 *
 * 使用方式：
 *   const picker = createPicker(容器元素, { brands, models, gender, brandId, modelId, assetBase, onChange })
 *   picker.setGender('女')     切換男款／女款
 *   picker.selected()          目前選到的鞋款（沒有選就是 null）
 */
import { shoeSVG, monogram } from './illustrations.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 鞋款圖：有照片用照片，沒有就用插畫 */
export function shoeArt(model, assetBase = '') {
  if (model.image) return `<img src="${esc(assetBase + model.image)}" alt="${esc(model.name)}" loading="lazy">`;
  return shoeSVG(model.art, model.name);
}

/** 鞋款卡片上的兩個重點標籤 */
function tags(m) {
  const toe = { 窄: '楦頭偏窄', 標準: '標準楦頭', 寬: '楦頭寬鬆' }[m.toeWidth];
  const second = m.stretch === 'high' ? '材質會撐開' : m.halfSizes ? '有半號' : '僅整數號';
  return [toe, second];
}

export function createPicker(root, opts) {
  const { brands, models, assetBase = '', onChange = () => {} } = opts;
  const state = { gender: opts.gender || '男', brandId: opts.brandId, category: '全部', modelId: opts.modelId || null };

  const forGender = (m) => m.gender === state.gender || m.gender === '中性';
  const brandModels = (id) => models.filter((m) => m.brandId === id && forGender(m));
  const visibleBrands = () => brands.filter((b) => brandModels(b.id).length);

  root.innerHTML = `
    <div class="picker-label">品牌</div>
    <div class="brand-rail" role="radiogroup" aria-label="品牌"></div>
    <div class="picker-label picker-label-row"><span>鞋款</span><span class="picker-hint">點選卡片</span></div>
    <div class="chips" role="radiogroup" aria-label="鞋款類型"></div>
    <div class="model-grid" role="radiogroup" aria-label="鞋款"></div>`;
  const rail = root.querySelector('.brand-rail');
  const chips = root.querySelector('.chips');
  const grid = root.querySelector('.model-grid');

  function ensureValid() {
    const vb = visibleBrands();
    if (!vb.some((b) => b.id === state.brandId)) {
      const fromModel = models.find((m) => m.id === state.modelId);
      state.brandId = fromModel && vb.some((b) => b.id === fromModel.brandId) ? fromModel.brandId : vb[0].id;
    }
    const list = brandModels(state.brandId);
    if (!list.some((m) => m.id === state.modelId)) state.modelId = null;
    const cats = new Set(list.map((m) => m.category));
    if (state.category !== '全部' && !cats.has(state.category)) state.category = '全部';
  }

  function renderBrands() {
    rail.innerHTML = visibleBrands()
      .map((b) => {
        const on = b.id === state.brandId;
        return `<button type="button" class="brand-card${on ? ' is-on' : ''}" role="radio" aria-checked="${on}" data-brand="${b.id}">
          <span class="mono">${esc(monogram(b.name))}</span>
          <span class="bname">${esc(b.name)}</span>
          <span class="borigin">${esc(b.origin)}・${brandModels(b.id).length} 款</span>
        </button>`;
      })
      .join('');
    const active = rail.querySelector('.is-on');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderChips() {
    const cats = [...new Set(brandModels(state.brandId).map((m) => m.category))];
    if (cats.length < 2) {
      chips.innerHTML = '';
      chips.hidden = true;
      return;
    }
    chips.hidden = false;
    chips.innerHTML = ['全部', ...cats]
      .map((c) => `<button type="button" class="chip${c === state.category ? ' is-on' : ''}" role="radio" aria-checked="${c === state.category}" data-cat="${esc(c)}">${esc(c)}</button>`)
      .join('');
  }

  function renderModels() {
    const list = brandModels(state.brandId).filter((m) => state.category === '全部' || m.category === state.category);
    grid.innerHTML = list
      .map((m) => {
        const on = m.id === state.modelId;
        return `<button type="button" class="model-card${on ? ' is-on' : ''}" role="radio" aria-checked="${on}" data-model="${m.id}">
          <span class="model-art">${shoeArt(m, assetBase)}</span>
          <span class="model-cat">${esc(m.category)}${m.gender === '中性' ? '・男女皆可' : ''}</span>
          <span class="model-name">${esc(m.name)}</span>
          <span class="model-tags">${tags(m).map((t) => `<span>${esc(t)}</span>`).join('')}</span>
          <span class="model-check" aria-hidden="true"></span>
        </button>`;
      })
      .join('');
  }

  function render() {
    ensureValid();
    renderBrands();
    renderChips();
    renderModels();
  }

  rail.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-brand]');
    if (!btn || btn.dataset.brand === state.brandId) return;
    state.brandId = btn.dataset.brand;
    state.category = '全部';
    state.modelId = null;
    render();
    onChange(null);
  });
  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    state.category = btn.dataset.cat;
    renderChips();
    renderModels();
  });
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-model]');
    if (!btn) return;
    state.modelId = btn.dataset.model;
    grid.querySelectorAll('.model-card').forEach((el) => {
      const on = el === btn;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-checked', on);
    });
    onChange(models.find((m) => m.id === state.modelId));
  });

  render();

  return {
    setGender(g) {
      state.gender = g;
      render();
      onChange(this.selected());
    },
    selected() {
      return models.find((m) => m.id === state.modelId) || null;
    },
  };
}
