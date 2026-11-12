// One function per chart. Each takes the theme colours and the API data and returns an ECharts option.
import { base, catAxis, valAxis, f0, f1, bandIndex, MONTHS } from './core.js';

const label = (t, extra = {}) => ({ show: true, color: t.ink2, fontFamily: t.mono, fontSize: 11, ...extra });

export function winters(t, rows) {
  const bar = (name, key, color, bold) => ({
    name, type: 'bar', barMaxWidth: 34, barGap: '10%', data: rows.map((r) => r[key]),
    itemStyle: { color, borderRadius: [3, 3, 0, 0] },
    label: label(t, { position: 'top', formatter: (p) => f0(p.value), color: bold ? t.ink : t.ink2, fontWeight: bold ? 500 : 400 }),
  });
  return base(t, {
    legend: { show: true, top: 0, left: 0, icon: 'roundRect', itemWidth: 11, itemHeight: 11, textStyle: { color: t.ink2, fontFamily: t.sans, fontSize: 12.5 } },
    tooltip: { ...base(t).tooltip, axisPointer: { type: 'shadow', shadowStyle: { color: t.grid } }, valueFormatter: (v) => f1(v) },
    xAxis: catAxis(t, rows.map((r) => r.winter)),
    yAxis: valAxis(t, { min: 0, max: 220, interval: 50, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, showMaxLabel: false } }),
    series: [bar('Raw', 'raw', t.raw, false), bar('Weather-adjusted', 'adjusted', t.accent, true)],
  });
}

export function yearly(t, rows) {
  const line = (name, key, color, w) => ({
    name, type: 'line', data: rows.map((r) => r[key]), symbolSize: 7, lineStyle: { width: w, color }, itemStyle: { color },
    endLabel: { show: true, formatter: (p) => f1(p.value), color, fontFamily: t.mono, fontSize: 11.5, fontWeight: 500 },
  });
  return base(t, {
    grid: { left: 4, right: 46, top: 36, bottom: 6, containLabel: true },
    legend: { show: true, top: 0, left: 0, icon: 'roundRect', itemWidth: 14, itemHeight: 3, textStyle: { color: t.ink2, fontFamily: t.sans, fontSize: 12.5 } },
    tooltip: { ...base(t).tooltip, valueFormatter: (v) => f1(v) },
    xAxis: catAxis(t, rows.map((r) => String(r.year)), { boundaryGap: false }),
    yAxis: valAxis(t, { min: 40, max: 100, interval: 20 }),
    series: [line('Raw', 'raw', t.raw, 2), line('Weather-adjusted', 'adjusted', t.accent, 2.4)],
  });
}

export function monthly(t, rows) {
  const line = (name, key, color, w) => ({ name, type: 'line', showSymbol: false, data: rows.map((r) => r[key]), lineStyle: { width: w, color }, itemStyle: { color }, emphasis: { disabled: true } });
  return base(t, {
    grid: { left: 4, right: 14, top: 36, bottom: 44, containLabel: true },
    legend: { show: true, top: 0, left: 0, icon: 'roundRect', itemWidth: 14, itemHeight: 3, textStyle: { color: t.ink2, fontFamily: t.sans, fontSize: 12.5 } },
    tooltip: { ...base(t).tooltip, valueFormatter: (v) => f1(v) },
    xAxis: catAxis(t, rows.map((r) => r.month), { boundaryGap: false, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, interval: 0, formatter: (v) => (v.endsWith('-01') ? v.slice(0, 4) : '') } }),
    yAxis: valAxis(t, { min: 0, max: 220, interval: 50, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, showMaxLabel: false } }),
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 4, borderColor: t.line, backgroundColor: t.grid, fillerColor: t.accentSoft, handleSize: 14, handleStyle: { color: t.accent, borderColor: t.accent }, moveHandleSize: 0, textStyle: { color: t.ink3, fontFamily: t.mono, fontSize: 10 }, dataBackground: { lineStyle: { color: t.line }, areaStyle: { color: t.grid } } }],
    series: [line('Raw', 'raw', t.raw, 1.4), line('Weather-adjusted', 'adjusted', t.accent, 2.2)],
  });
}

export function lockdown(t, rows) {
  return base(t, {
    grid: { left: 4, right: 14, top: 24, bottom: 6, containLabel: true },
    tooltip: { ...base(t).tooltip, formatter: (ps) => { const r = rows[ps[0].dataIndex]; return `${r.year}<br>measured ${f1(r.measured)}<br>expected ${f1(r.expected)}<br>${r.change_pct > 0 ? '+' : ''}${r.change_pct}%`; } },
    xAxis: catAxis(t, rows.map((r) => String(r.year)), { axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11 }, axisPointer: { type: 'shadow' } }),
    yAxis: valAxis(t, { min: -50, max: 40, interval: 25, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: (v) => `${v}%` } }),
    series: [{
      type: 'bar', barMaxWidth: 46,
      data: rows.map((r) => ({ value: r.change_pct, itemStyle: { color: r.year === 2020 ? t.warm : t.raw, borderRadius: r.change_pct < 0 ? [0, 0, 3, 3] : [3, 3, 0, 0] } })),
      label: label(t, { position: 'outside', formatter: (p) => `${p.value > 0 ? '+' : ''}${p.value}%` }),
      markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: t.ink3, width: 1, type: 'solid' }, data: [{ yAxis: 0 }] },
    }],
  });
}

// Calendar heatmap: one square per day, coloured by the CPCB category.
export function calendar(t, year, days) {
  const [b1, b2, b3, b4, b5, b6] = t.bands;
  return {
    animation: false, textStyle: { fontFamily: t.mono },
    tooltip: {
      trigger: 'item', confine: true, backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, padding: [8, 10],
      textStyle: { color: t.ink, fontFamily: t.mono, fontSize: 12 }, extraCssText: 'box-shadow:none;border-radius:4px;',
      formatter: (p) => `${p.value[0]}<br>${f0(p.value[1])} µg/m³ · ${['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very poor', 'Severe'][bandIndex(p.value[1])]}<br><span style="color:${t.ink3}">click for the hours</span>`,
    },
    visualMap: {
      type: 'piecewise', show: false, dimension: 1,
      pieces: [{ lte: 30, color: b1 }, { gt: 30, lte: 60, color: b2 }, { gt: 60, lte: 90, color: b3 }, { gt: 90, lte: 120, color: b4 }, { gt: 120, lte: 250, color: b5 }, { gt: 250, color: b6 }],
    },
    calendar: {
      top: 26, left: 30, right: 6, bottom: 4, cellSize: ['auto', 16], range: String(year),
      itemStyle: { color: t.empty, borderWidth: 2, borderColor: t.surface },
      splitLine: { show: true, lineStyle: { color: t.ink3, width: 1, opacity: .45 } },
      yearLabel: { show: false },
      monthLabel: { nameMap: 'en', color: t.ink3, fontFamily: t.mono, fontSize: 11, margin: 8 },
      dayLabel: { firstDay: 1, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'], color: t.ink3, fontFamily: t.mono, fontSize: 10, margin: 8 },
    },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: days.map((d) => [d.date, d.pm25]), emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1.5 } } }],
  };
}

// Hour of day (across) against month (down).
export function hourMonth(t, cells) {
  const max = Math.ceil(Math.max(...cells.map((c) => c.pm25)) / 10) * 10;
  return {
    animation: false, textStyle: { fontFamily: t.mono },
    grid: { left: 4, right: 10, top: 6, bottom: 58, containLabel: true },
    tooltip: {
      trigger: 'item', confine: true, backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, padding: [8, 10],
      textStyle: { color: t.ink, fontFamily: t.mono, fontSize: 12 }, extraCssText: 'box-shadow:none;border-radius:4px;',
      formatter: (p) => `${MONTHS[p.value[1]]}, ${String(p.value[0]).padStart(2, '0')}:00<br>${f0(p.value[2])} µg/m³ <span style="color:${t.ink3}">(${p.value[3]} hours)</span>`,
    },
    xAxis: { type: 'category', data: [...Array(24).keys()].map((h) => String(h).padStart(2, '0')), splitArea: { show: false }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, interval: 2 } },
    yAxis: { type: 'category', data: MONTHS, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11 } },
    visualMap: { type: 'continuous', dimension: 2, min: 20, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 6, itemWidth: 12, itemHeight: 220, text: [`${max}`, '20'], textStyle: { color: t.ink3, fontFamily: t.mono, fontSize: 11 }, inRange: { color: [t.rampLo, t.rampHi] } },
    series: [{ type: 'heatmap', data: cells.map((c) => [c.hour, c.month - 1, c.pm25, c.n]), itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 2 }, emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1.5 } } }],
  };
}

export function dayLine(t, hours, key, opts = {}) {
  const xs = [...Array(24).keys()].map((h) => String(h).padStart(2, '0'));
  const series = [{ name: opts.name || 'Measured', type: 'line', showSymbol: false, data: hours.map((r) => r[key]), lineStyle: { width: 2.2, color: opts.color || t.ink }, itemStyle: { color: opts.color || t.ink }, connectNulls: false }];
  if (opts.expected) series.push({ name: 'Weather-predicted', type: 'line', showSymbol: false, data: hours.map((r) => r.expected), lineStyle: { width: 1.8, color: t.accent, type: 'dashed' }, itemStyle: { color: t.accent } });
  return base(t, {
    grid: { left: 4, right: 10, top: 20, bottom: 6, containLabel: true },
    tooltip: { ...base(t).tooltip, valueFormatter: (v) => (v == null ? 'no reading' : f1(v)) },
    xAxis: catAxis(t, xs, { boundaryGap: false, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, interval: 5 } }),
    yAxis: valAxis(t, opts.log ? { type: 'log', min: 10, max: 4000, logBase: 10 } : { min: opts.min ?? 0 }),
    series,
  });
}

export function blhBins(t, bins) {
  return base(t, {
    grid: { left: 4, right: 14, top: 24, bottom: 6, containLabel: true },
    tooltip: { ...base(t).tooltip, axisPointer: { type: 'shadow', shadowStyle: { color: t.grid } }, formatter: (ps) => { const b = bins[ps[0].dataIndex]; return `Layer ${f0(b.lo)} to ${f0(b.hi)} m<br>${f1(b.pm25)} µg/m³<br><span style="color:${t.ink3}">${f0(b.n)} hours</span>`; } },
    xAxis: catAxis(t, bins.map((b) => (b.bin === 1 ? `<${f0(b.hi)}` : b.bin === bins.length ? `>${f0(b.lo)}` : `${f0(b.lo)}–${f0(b.hi)}`)), { name: 'Boundary layer height, m', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: t.ink3, fontFamily: t.mono, fontSize: 11 }, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 10.5, interval: 0 } }),
    yAxis: valAxis(t, { min: 0, max: 220, interval: 50, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, showMaxLabel: false } }),
    series: [{ type: 'bar', barMaxWidth: 40, data: bins.map((b) => ({ value: b.pm25, itemStyle: { color: t.accent, opacity: .35 + .65 * (1 - (b.bin - 1) / (bins.length - 1)), borderRadius: [3, 3, 0, 0] } })), label: label(t, { position: 'top', formatter: (p) => f0(p.value) }) }],
  });
}

export function importance(t, rows) {
  const r = [...rows].reverse();
  return base(t, {
    grid: { left: 4, right: 40, top: 6, bottom: 22, containLabel: true },
    tooltip: { ...base(t).tooltip, axisPointer: { type: 'shadow', shadowStyle: { color: t.grid } }, valueFormatter: (v) => v.toFixed(3) },
    xAxis: valAxis(t, { name: 'Drop in R² when shuffled', nameLocation: 'middle', nameGap: 26, min: 0 }),
    yAxis: { type: 'category', data: r.map((x) => x.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.ink2, fontFamily: t.sans, fontSize: 12 } },
    series: [{ type: 'bar', barMaxWidth: 16, data: r.map((x) => x.importance), itemStyle: { color: t.accent, borderRadius: [0, 3, 3, 0] }, label: label(t, { position: 'right', formatter: (p) => p.value.toFixed(2) }) }],
  });
}

export function expected(t, days) {
  return base(t, {
    grid: { left: 4, right: 14, top: 12, bottom: 6, containLabel: true },
    tooltip: { ...base(t).tooltip, valueFormatter: (v) => (v == null ? '–' : f1(v)) },
    xAxis: { type: 'time', axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false }, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11 }, splitLine: { show: false } },
    yAxis: valAxis(t, { min: 0, name: 'µg/m³', nameGap: 14 }),
    series: [
      { name: 'Measured', type: 'line', showSymbol: false, data: days.map((d) => [d.date, d.pm25]), lineStyle: { width: 2, color: t.ink }, itemStyle: { color: t.ink } },
      { name: 'Predicted from weather', type: 'line', showSymbol: false, data: days.map((d) => [d.date, d.expected]), lineStyle: { width: 2, color: t.accent, type: 'dashed' }, itemStyle: { color: t.accent } },
    ],
  });
}

// Two stations over time. `field` is "slope" or "corr".
export function stations(t, rows, field, fault) {
  const by = (name) => rows.filter((r) => r.station === name).map((r) => [`${r.month}-15`, r[field]]);
  const isSlope = field === 'slope';
  const lal = {
    name: 'Lalbagh', type: 'line', showSymbol: false, data: by('Lalbagh'), lineStyle: { width: 2.4, color: t.accent }, itemStyle: { color: t.accent }, z: 3,
    markArea: {
      silent: true, label: { show: false },
      data: [
        [{ xAxis: fault.start, itemStyle: { color: t.warnFill } }, { xAxis: fault.end }],
        ...(isSlope ? [[{ yAxis: 0.40, itemStyle: { color: t.okFill } }, { yAxis: 0.52 }]] : []),
      ],
    },
    markLine: { silent: true, symbol: 'none', lineStyle: { color: t.warm, width: 1.5, type: 'dashed' }, label: { show: true, position: 'insideEndTop', formatter: '20 Oct 2025', color: t.warm, fontFamily: t.mono, fontSize: 11 }, data: [{ xAxis: fault.start }] },
  };
  const brau = { name: 'B R Ambedkar University', type: 'line', showSymbol: false, data: by('B R Ambedkar'), lineStyle: { width: 2, color: t.warm }, itemStyle: { color: t.warm }, z: 2 };
  return base(t, {
    grid: { left: 4, right: 14, top: 16, bottom: 6, containLabel: true },
    tooltip: { ...base(t).tooltip, valueFormatter: (v) => (v == null ? '–' : v.toFixed(2)) },
    xAxis: { type: 'time', axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false }, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11 }, splitLine: { show: false } },
    yAxis: valAxis(t, isSlope ? { min: 0.1, max: 0.8, interval: 0.1 } : { min: -0.4, max: 1, interval: 0.2 }),
    series: [lal, brau],
  });
}

export function sweep(t, xs, ys, at, xLabel, log) {
  return base(t, {
    grid: { left: 4, right: 16, top: 20, bottom: 24, containLabel: true },
    tooltip: { ...base(t).tooltip, trigger: 'axis', valueFormatter: (v) => `${f0(v)} µg/m³` },
    xAxis: { type: log ? 'log' : 'value', min: xs[0], max: xs[xs.length - 1], name: xLabel, nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: t.ink3, fontFamily: t.mono, fontSize: 11 }, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false }, axisLabel: { color: t.ink3, fontFamily: t.mono, fontSize: 11, formatter: (v) => (log ? f0(v) : String(+v.toFixed(1))) }, splitLine: { show: false } },
    yAxis: valAxis(t, { min: 0 }),
    series: [{
      type: 'line', showSymbol: false, data: xs.map((x, i) => [x, ys[i]]), lineStyle: { width: 2.4, color: t.accent }, itemStyle: { color: t.accent },
      markLine: { silent: true, symbol: 'none', lineStyle: { color: t.ink, width: 1.2, type: 'dashed' }, label: { show: false }, data: [{ xAxis: at }] },
    }],
  });
}
