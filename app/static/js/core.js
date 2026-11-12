// Small helpers shared by every view: fetching, theme colours, and chart plumbing.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---- data ----------------------------------------------------------------
// Responses are cached by URL for the life of the page, so switching views never refetches.
const cache = new Map();
export function api(path) {
  if (!cache.has(path)) {
    const p = fetch(path).then(async (r) => {
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed (${r.status})`);
      }
      return r.json();
    });
    p.catch(() => cache.delete(path)); // a failed request can be retried
    cache.set(path, p);
  }
  return cache.get(path);
}

// ---- theme ---------------------------------------------------------------
// Colours live in CSS custom properties. Charts read them at draw time, so light and dark both work.
export function tok() {
  const s = getComputedStyle(document.documentElement);
  const g = (n) => s.getPropertyValue(n).trim();
  return {
    ink: g('--ink'), ink2: g('--ink2'), ink3: g('--ink3'), line: g('--line'), grid: g('--grid'), surface: g('--surface'),
    empty: g('--empty'), accent: g('--accent'), accentSoft: g('--accent-soft'), raw: g('--raw'), warm: g('--warm'),
    warnFill: g('--warn-fill'), okFill: g('--ok-fill'), good: g('--good'),
    rampLo: g('--ramp-lo'), rampHi: g('--ramp-hi'), mono: g('--mono'), sans: g('--sans'),
    bands: ['--b1', '--b2', '--b3', '--b4', '--b5', '--b6'].map(g),
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

// ---- charts --------------------------------------------------------------
const live = new Map();
export function draw(id, option) {
  const el = document.getElementById(id);
  let chart = live.get(id);
  if (chart && (chart.isDisposed() || chart.getDom() !== el)) chart = null;
  if (!chart) {
    chart = echarts.init(el, null, { renderer: 'canvas' });
    live.set(id, chart);
  }
  chart.setOption(option, true);
  chart.resize();
  return chart;
}
export function resizeAll() {
  live.forEach((c) => !c.isDisposed() && c.getDom().offsetParent && c.resize());
}
let timer;
addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(resizeAll, 120); });

// Options every chart shares.
export function base(t, extra = {}) {
  return {
    animation: !t.reduced, animationDuration: 380, animationEasing: 'cubicOut',
    textStyle: { fontFamily: t.mono, color: t.ink2 },
    grid: { left: 4, right: 14, top: 36, bottom: 6, containLabel: true },
    tooltip: {
      trigger: 'axis', confine: true, backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, padding: [8, 10],
      textStyle: { color: t.ink, fontFamily: t.mono, fontSize: 12 }, extraCssText: 'box-shadow:none;border-radius:4px;',
      axisPointer: { lineStyle: { color: t.ink3, type: 'dashed' } },
    },
    legend: { show: false },
    ...extra,
  };
}
export const catAxis = (t, data, extra = {}) => ({
  type: 'category', data, boundaryGap: true,
  axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false },
  axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11 }, ...extra,
});
export const valAxis = (t, extra = {}) => ({
  type: 'value', axisLine: { show: false }, axisTick: { show: false },
  axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } },
  nameTextStyle: { color: t.ink3, fontFamily: t.mono, fontSize: 11 }, ...extra,
});

// ---- misc ----------------------------------------------------------------
export const f0 = (v) => Math.round(v).toLocaleString('en-US');
export const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
export const BAND_EDGES = [30, 60, 90, 120, 250];
export const bandIndex = (v) => { const i = BAND_EDGES.findIndex((e) => v <= e); return i < 0 ? 5 : i; };
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function chips(el, items, current, onPick) {
  el.innerHTML = items.map((i) => `<button type="button" data-v="${i.value}" aria-pressed="${String(i.value) === String(current)}">${i.label}</button>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    onPick(b.dataset.v);
  };
}

export function legend(el, items) {
  el.innerHTML = items.map(({ label, color, kind }) =>
    `<span><i class="${kind || ''}" style="${kind === 'dash' ? `border-color:${color}` : `background:${color}`}"></i>${label}</span>`).join('');
}

// Wrap a view section so a failed request shows a message and a retry button instead of a blank chart.
export async function guard(chartIds, fn) {
  try {
    await fn();
  } catch (e) {
    const el = document.getElementById(chartIds[0]);
    if (el) {
      el.innerHTML = `<p class="err">Could not load this chart: ${e.message}<button class="ghost" type="button">Retry</button></p>`;
      el.querySelector('button').onclick = () => { el.innerHTML = ''; guard(chartIds, fn); };
    }
  }
}
