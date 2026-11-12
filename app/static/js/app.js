// Page logic: hash router, one render function per view, and the simulator wiring.
import { $, $$, api, tok, draw, resizeAll, chips, legend, guard, f0, f1, bandIndex, MONTHS } from './core.js';
import * as C from './charts.js';

const BAND_NAMES = ['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very poor', 'Severe'];
const BAND_RANGES = ['≤30', '31–60', '61–90', '91–120', '121–250', '>250'];
const FAULT = { start: '2025-10-20', end: '2026-02-28' };
const state = { year: 2024, hmYear: 'all', winter: 2023 };
const rendered = new Set();

// ============================================================ overview
async function overview() {
  const t = tok();
  await guard(['kpis'], async () => {
    const s = await api('/api/summary');
    const w = s.winters, last = w[w.length - 1], first = w[0];
    $('#kpis').innerHTML = [
      ['Latest winter, adjusted', f0(last.weather_adjusted), `µg/m³ in ${last.winter}. It was ${f0(first.weather_adjusted)} in ${first.winter}.`],
      ['Lockdown against expected', `${String(s.lockdown.change_pct).replace('-', '−')}%`, `March to May 2020. In ordinary years the same test is off by up to ${s.lockdown_error_pct}%.`],
      ['Model accuracy, held out', `${s.model.r2_daily.toFixed(2)}`, `R² for daily means. Hourly is ${s.model.r2_hourly.toFixed(2)}.`],
      ['Hours left out', f0(s.model.hours_excluded), 'Lalbagh PM2.5 from 20 Oct 2025, when the sensor misbehaved.'],
    ].map(([k, v, n]) => `<div><span class="k">${k}</span><span class="v">${v}</span><span class="n">${n}</span></div>`).join('');
  });
  await guard(['ch-winters'], async () => draw('ch-winters', C.winters(t, await api('/api/winters'))));
  await guard(['ch-yearly'], async () => draw('ch-yearly', C.yearly(t, await api('/api/yearly'))));
  await guard(['ch-monthly'], async () => draw('ch-monthly', C.monthly(t, await api('/api/monthly'))));
  await guard(['ch-lockdown'], async () => {
    const rows = await api('/api/lockdown');
    draw('ch-lockdown', C.lockdown(t, rows));
    const l = rows.find((r) => r.year === 2020);
    const worst = Math.max(...rows.filter((r) => r.year !== 2020).map((r) => Math.abs(r.change_pct)));
    $('#lockdown-read').innerHTML = `<b>In 2020 the measured average (${f0(l.measured)}) was ${Math.abs(l.change_pct)}% below the expected ${f0(l.expected)}.</b> In the other years, when nothing unusual happened, the same method was off by as much as ${worst}% in either direction. The lockdown effect is clearly there, but its size is only known roughly.`;
  });
}

// ============================================================ calendar
async function calendar() {
  const t = tok();
  legend($('#band-legend'), BAND_NAMES.map((n, i) => ({ label: `${n} <span style="color:var(--ink3)">${BAND_RANGES[i]}</span>`, color: t.bands[i] })).concat([{ label: 'No data', color: t.empty }]));
  const years = [2020, 2021, 2022, 2023, 2024, 2025].map((y) => ({ value: y, label: y }));
  chips($('#year-chips'), years, state.year, (v) => { state.year = +v; calendar(); closeDay(); });
  await guard(['ch-calendar'], async () => {
    const d = await api(`/api/calendar?year=${state.year}`);
    const c = draw('ch-calendar', C.calendar(t, state.year, d.days));
    c.off('click');
    c.on('click', (p) => p.value && openDay(p.value[0]));
    const total = d.days.length, bad = (d.counts['Very poor'] || 0) + (d.counts['Severe'] || 0);
    const note = state.year === 2025 ? ' Data ends on 19 October 2025.' : state.year === 2020 ? ' Data starts on 3 January 2020.' : '';
    $('#cal-summary').textContent = `${state.year}: ${bad} of ${total} days with data were Very poor or Severe.${note}`;
  });
  const hmYears = [{ value: 'all', label: 'All years' }, ...years];
  chips($('#hm-chips'), hmYears, state.hmYear, (v) => { state.hmYear = v; hourMonth(); });
  await hourMonth();
}

async function hourMonth() {
  const t = tok();
  await guard(['ch-hm'], async () => {
    const d = await api(`/api/hour-month${state.hmYear === 'all' ? '' : `?year=${state.hmYear}`}`);
    draw('ch-hm', C.hourMonth(t, d.cells));
    const hi = d.cells.reduce((a, b) => (b.pm25 > a.pm25 ? b : a)), lo = d.cells.reduce((a, b) => (b.pm25 < a.pm25 ? b : a));
    const h = (c) => `${MONTHS[c.month - 1]} at ${String(c.hour).padStart(2, '0')}:00`;
    $('#hm-read').innerHTML = `<b>Highest average: ${h(hi)}, ${f0(hi.pm25)} µg/m³.</b> Lowest: ${h(lo)}, ${f0(lo.pm25)} µg/m³. The dirtiest hours cluster in the evening, from late autumn to February. ${state.hmYear === '2025' ? 'Months after 19 October are empty for 2025.' : ''}`;
  });
}

function closeDay() { $('#day-card').hidden = true; }
async function openDay(date) {
  const t = tok();
  const card = $('#day-card');
  card.hidden = false;
  await guard(['ch-day-pm'], async () => {
    const d = await api(`/api/day/${date}`);
    const vals = d.hours.map((h) => h.pm25).filter((v) => v != null);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const nice = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('#day-title').textContent = nice;
    $('#day-sub').textContent = `Daily mean ${f0(mean)} µg/m³, ${BAND_NAMES[bandIndex(mean)]}. The dashed line is what the weather-only model predicted for each hour.`;
    draw('ch-day-pm', C.dayLine(t, d.hours, 'pm25', { expected: true }));
    draw('ch-day-blh', C.dayLine(t, d.hours, 'blh_m', { color: t.warm, log: true, name: 'Boundary layer' }));
    draw('ch-day-wind', C.dayLine(t, d.hours, 'wind_speed', { color: t.ink2, name: 'Wind' }));
    card.scrollIntoView({ behavior: tok().reduced ? 'auto' : 'smooth', block: 'nearest' });
  });
}
$('#day-close').onclick = closeDay;

// ============================================================ weather
async function weather() {
  const t = tok();
  await guard(['ch-blh'], async () => {
    const bins = await api('/api/blh-bins');
    draw('ch-blh', C.blhBins(t, bins));
    const a = bins[0], z = bins[bins.length - 1];
    $('#blh-read').innerHTML = `<b>When the layer was under ${f0(a.hi)} m, PM2.5 averaged ${f0(a.pm25)}.</b> Above ${f0(z.lo)} m it averaged ${f0(z.pm25)}, so trapped air carried about ${(a.pm25 / z.pm25).toFixed(1)} times as much. Cold, still nights are both shallow and slow to clear, so part of this gap is shared with other weather.`;
  });
  await guard(['ch-imp'], async () => draw('ch-imp', C.importance(t, await api('/api/importance?top=8'))));

  const wins = [2020, 2021, 2022, 2023, 2024].map((y) => ({ value: y, label: `${y}-${String(y + 1).slice(2)}` }));
  chips($('#exp-chips'), wins, state.winter, (v) => { state.winter = +v; expectedChart(); });
  await expectedChart();
}

async function expectedChart() {
  const t = tok();
  legend($('#exp-legend'), [{ label: 'Measured', color: t.ink, kind: 'ln' }, { label: 'Predicted from weather', color: t.accent, kind: 'dash' }]);
  await guard(['ch-exp'], async () => {
    const y = state.winter;
    const d = await api(`/api/expected?start=${y}-10-15&end=${y + 1}-02-28`);
    draw('ch-exp', C.expected(t, d.days));
    const m = await api('/api/summary');
    const mean = (k) => d.days.reduce((a, r) => a + r[k], 0) / d.days.length;
    $('#model-read').innerHTML = `<b>Winter ${y}-${String(y + 1).slice(2)}: measured ${f0(mean('pm25'))}, predicted ${f0(mean('expected'))} µg/m³ on average.</b> Over all held-out days the model explains ${Math.round(m.model.r2_daily * 100)}% of day-to-day variation (${Math.round(m.model.r2_hourly * 100)}% hour to hour). Where the lines part, something other than weather is at work, or the model has missed a pattern.`;
  });
}

// ============================================================ stations
async function stations() {
  const t = tok();
  legend($('#st-legend'), [
    { label: 'Lalbagh', color: t.accent, kind: 'ln' }, { label: 'B R Ambedkar University', color: t.warm, kind: 'ln' },
    { label: 'Usual range 0.40–0.52', color: t.okFill }, { label: 'Excluded: 20 Oct 2025 to Feb 2026', color: t.warnFill },
  ]);
  await guard(['ch-slope'], async () => {
    const d = await api('/api/stations');
    draw('ch-slope', C.stations(t, d.slope, 'slope', FAULT));
    draw('ch-corr', C.stations(t, d.slope, 'corr', FAULT));
    const pct = (v) => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
    $('#compare').innerHTML = `<thead><tr><th>Station</th><th class="num">PM2.5 2024</th><th class="num">PM2.5 2025</th><th class="num">Change</th><th class="num">PM10 change</th><th class="num">PM2.5 ÷ PM10</th></tr></thead><tbody>` +
      d.compare.map((r, i) => `<tr><td>${r.station}</td><td class="num">${f0(r.pm25_2024)}</td><td class="num">${f0(r.pm25_2025)}</td><td class="num ${i === 0 ? 'neg' : ''}">${pct(r.pm25_change_pct)}</td><td class="num">${pct(r.pm10_change_pct)}</td><td class="num ${i === 0 ? 'neg' : ''}">${r.ratio_2024.toFixed(2)} → ${r.ratio_2025.toFixed(2)}</td></tr>`).join('') + '</tbody>';
  });
}

// ============================================================ simulator
const PRESETS = {
  'Still December night': { month: 12, hour: 22, temp_c: 9, humidity_pct: 85, wind_speed: 0.8, blh_m: 45, rain_mm: 0 },
  'November evening': { month: 11, hour: 19, temp_c: 20, humidity_pct: 60, wind_speed: 1.5, blh_m: 120, rain_mm: 0 },
  'Windy April afternoon': { month: 4, hour: 15, temp_c: 36, humidity_pct: 25, wind_speed: 4.5, blh_m: 2200, rain_mm: 0 },
  'Monsoon day': { month: 8, hour: 14, temp_c: 31, humidity_pct: 80, wind_speed: 2.5, blh_m: 900, rain_mm: 1.5 },
};
const FIELDS = [['blh_m', 'm', 0], ['wind_speed', 'm/s', 1], ['temp_c', '°C', 1], ['humidity_pct', '%', 0], ['rain_mm', 'mm', 1]];
let sim = null, simTimer = 0, simSeq = 0;

async function simulator() {
  if (!sim) {
    const { model } = await api('/api/summary');
    sim = { ranges: model.ranges, card: model, values: { ...PRESETS['Still December night'] } };
    $('#in-month').innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][i]}</option>`).join('');
    // Boundary layer height is steered on a log scale: the interesting part is 20 to 500 m.
    const r = sim.ranges;
    const setup = (id, lo, hi, step) => { const el = $(`#in-${id}`); el.min = lo; el.max = hi; el.step = step; };
    setup('wind_speed', 0, Math.ceil(r.wind_speed[1]), 0.1);
    setup('temp_c', Math.floor(r.temp_c[0]), Math.ceil(r.temp_c[1]), 0.5);
    setup('humidity_pct', Math.floor(r.humidity_pct[0]), Math.ceil(r.humidity_pct[1]), 1);
    setup('rain_mm', 0, +r.rain_mm[1].toFixed(1), 0.1);
    $('#in-blh_m').min = 0; $('#in-blh_m').max = 100; $('#in-blh_m').step = 0.5;
    chips($('#presets'), Object.keys(PRESETS).map((k) => ({ value: k, label: k })), '', (k) => { sim.values = { ...PRESETS[k] }; syncInputs(); runSim(); });
    $$('.controls input, .controls select').forEach((el) => el.addEventListener('input', () => { readInputs(); runSim(); }));
    $('#sim-card').textContent = `Simplified model: month, hour and five weather readings only, with no long-term trend. In held-out testing it explains ${Math.round(model.sim_r2_hourly * 100)}% of hour-to-hour variation, against ${Math.round(model.r2_hourly * 100)}% for the full model on the other pages. It knows nothing about traffic, burning or festivals.`;
    syncInputs();
  }
  buildGauge();
  runSim();
}
const blhFromSlider = (s) => { const [lo, hi] = sim.ranges.blh_m; return lo * Math.pow(hi / lo, s / 100); };
const sliderFromBlh = (b) => { const [lo, hi] = sim.ranges.blh_m; return (100 * Math.log(Math.max(b, lo) / lo)) / Math.log(hi / lo); };
function syncInputs() {
  const v = sim.values;
  $('#in-month').value = v.month; $('#in-hour').value = v.hour; $('#o-hour').textContent = `${String(v.hour).padStart(2, '0')}:00`;
  $('#in-blh_m').value = sliderFromBlh(v.blh_m);
  for (const [k, unit, dp] of FIELDS) {
    if (k !== 'blh_m') $(`#in-${k}`).value = v[k];
    $(`#o-${k}`).textContent = `${(+v[k]).toFixed(k === 'blh_m' ? 0 : dp)} ${unit}`;
  }
}
function readInputs() {
  const v = sim.values;
  v.month = +$('#in-month').value; v.hour = +$('#in-hour').value;
  v.blh_m = blhFromSlider(+$('#in-blh_m').value);
  for (const [k] of FIELDS) if (k !== 'blh_m') v[k] = +$(`#in-${k}`).value;
  syncInputs();
}
function buildGauge() {
  const t = tok(), edges = [30, 60, 90, 120, 250, 300], g = $('#gauge');
  let prev = 0;
  g.innerHTML = edges.map((e, i) => { const w = ((e - prev) / 300) * 100; prev = e; return `<i style="width:${w}%;background:${t.bands[i]}"></i>`; }).join('') + '<span class="range" id="g-range"></span><span class="mark" id="g-mark"></span>';
  $('.gauge-scale').innerHTML = [0, 30, 60, 90, 120, 250, 300].map((v) => `<span style="position:absolute;left:${(v / 300) * 100}%;transform:translateX(${v === 0 ? '0' : v === 300 ? '-100%' : '-50%'})">${v === 300 ? '300+' : v}</span>`).join('');
}
function runSim() {
  clearTimeout(simTimer);
  simTimer = setTimeout(async () => {
    const seq = ++simSeq, t = tok(), v = sim.values;
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(Math.round(x * 100) / 100)])));
    try {
      const [r, sb, sw] = await Promise.all([fetch(`/api/simulate?${qs}`).then(ok), fetch(`/api/simulate/sweep?variable=blh_m&${qs}`).then(ok), fetch(`/api/simulate/sweep?variable=wind_speed&${qs}`).then(ok)]);
      if (seq !== simSeq) return; // a newer request has already been sent
      $('#res-val').textContent = f0(r.pm25);
      $('#res-text').innerHTML = `The model expects ${f0(r.low)} to ${f0(r.high)} µg/m³ under these conditions. On the CPCB 24-hour scale that is <span class="pill" style="background:${t.bands[r.band_index]}">${r.band}</span>`;
      $('#res-fine').textContent = `The range runs from the model's 10th to its 90th percentile. In testing, ${Math.round(sim.card.sim_interval_coverage * 100)}% of real hours fell inside ranges like this. Categories are defined for 24-hour averages, so for a single hour they are only a guide.`;
      $('#g-mark').style.left = `${Math.min(r.pm25, 300) / 3}%`;
      $('#g-range').style.left = `${Math.min(r.low, 300) / 3}%`;
      $('#g-range').style.width = `${(Math.min(r.high, 300) - Math.min(r.low, 300)) / 3}%`;
      draw('ch-sw-blh', C.sweep(t, sb.x, sb.pm25, v.blh_m, 'Boundary layer height, m (log scale)', true));
      draw('ch-sw-wind', C.sweep(t, sw.x, sw.pm25, v.wind_speed, 'Wind speed, m/s', false));
    } catch (e) {
      $('#res-text').textContent = `Could not reach the model: ${e.message}`;
    }
  }, 90);
}
const ok = async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText); return r.json(); };

// ============================================================ router
const VIEWS = { overview, calendar, weather, stations, simulator };
const TITLES = { overview: 'Overview', calendar: 'Calendar', weather: 'Weather', stations: 'Stations', simulator: 'Simulator' };
let current = 'overview';

async function route() {
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1];
  current = VIEWS[name] ? name : 'overview';
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== current; });
  $$('#nav a').forEach((a) => (a.getAttribute('href') === `#/${current}` ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.title = `${TITLES[current]} · Lucknow Winter Air`;
  scrollTo(0, 0);
  rendered.add(current);
  await VIEWS[current]();
  resizeAll();
}
addEventListener('hashchange', route);
// Redraw when the system switches between light and dark.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => VIEWS[current]());
route();
