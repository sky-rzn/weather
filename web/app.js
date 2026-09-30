// ============================================================
// CONFIG
// ============================================================
const REFRESH_INTERVAL = 30000;

// Locale shortcut
const L = window.APP_LOCALE;

function degToDir(deg) {
  return L.windDirs[Math.round(deg / 22.5) % 16];
}

function uvLabel(uv) {
  const v = parseFloat(uv);
  if (v < 3)  return L.uvLabels[0];
  if (v < 6)  return L.uvLabels[1];
  if (v < 8)  return L.uvLabels[2];
  if (v < 11) return L.uvLabels[3];
  return L.uvLabels[4];
}

// ============================================================
// COLOR PALETTE
// ============================================================
const COLOR_A     = '#57cbff';
const COLOR_A_MIN = '#57bfed';
const COLOR_A_MAX = '#57bfed';
const COLOR_B     = '#73ffba';
const COLOR_B_MIN = '#66dfa4';
const COLOR_B_MAX = '#66dfa4';

// ============================================================
// CHART FIELDS MAP
// ============================================================
const CHART_FIELDS = {
  pressure: ['p'],
  dewpoint:  ['out_d'],
  uv:        ['uv'],
  solar:     ['rad'],
  rain:      ['pr'],
  wind:      ['ws', 'wd'],
  indoor:    ['in_t', 'in_h'],
  bathroom:  ['in_t2', 'in_h2'],
  temp:      ['out_t', 'out_h'],
  humidity:  ['out_h'],
};

// Fields supported by /30d endpoint (aggregated daily)
const CHART_FIELDS_30D = {
  pressure: ['p'],
  dewpoint:  ['out_d'],
  uv:        ['uv'],
  solar:     ['rad'],
  rain:      ['prd'],
  wind:      ['ws', 'wd'],
  indoor:    ['in_t', 'in_h'],
  bathroom:  ['in_t2', 'in_h2'],
  temp:      ['out_t', 'out_h'],
  humidity:  ['out_h'],
};

// ============================================================
// DATASET BUILDERS
// ============================================================
function buildTriple(data, avgKey, minKey, maxKey, label, unit, palette, yAxisID, decimals = 1) {
  const C = palette === 'B'
    ? { avg: COLOR_B, min: COLOR_B_MIN, max: COLOR_B_MAX }
    : { avg: COLOR_A, min: COLOR_A_MIN, max: COLOR_A_MAX };
  const fillColor = palette === 'B' ? 'rgba(40,88,64,0.3)' : 'rgba(34,75,93,0.3)';
  const val = (row, key) => row[key] != null ? parseFloat(row[key]).toFixed(decimals) : null;
  return [
    { label: `${label} min ${unit}`, data: data.map(d => val(d, minKey)),
      borderColor: C.min, backgroundColor: fillColor,
      fill: '+1', borderWidth: 1, borderDash: [4,3], pointRadius: 0, tension: 0.4, yAxisID },
    { label: `${label} max ${unit}`, data: data.map(d => val(d, maxKey)),
      borderColor: C.max, backgroundColor: 'transparent',
      borderWidth: 1, borderDash: [4,3], pointRadius: 0, tension: 0.4, fill: false, yAxisID },
    { label: `${label} avg ${unit}`, data: data.map(d => val(d, avgKey)),
      borderColor: C.avg, backgroundColor: 'transparent',
      borderWidth: 1, pointRadius: 0, pointHoverRadius: 3, tension: 0.4, fill: false, yAxisID },
  ];
}

function buildBar(data, key, label, unit, palette, yAxisID, decimals = 2) {
  const color = palette === 'B' ? COLOR_B : COLOR_A;
  return [{
    label: `${label} ${unit}`,
    data: data.map(d => d[key] != null ? parseFloat(d[key]).toFixed(decimals) : null),
    backgroundColor: color.replace(')', ', 0.5)').replace('rgb', 'rgba'),
    borderColor: color, borderWidth: 1, yAxisID,
  }];
}

// ============================================================
// CHART CONFIGS — built from locale
// ============================================================
function buildChartConfigs() {
  const dl = L.datasetLabels;
  const ct = L.chartTitles;
  return {
    pressure: {
      title: ct.pressure,
      title30d: ct.pressure30d,
      datasets: (data) => buildTriple(data, 'p_avg','p_min','p_max', dl.pressure[0], dl.pressure[1], 'A','y',1),
      yColor: COLOR_A, hasY1: false,
    },
    dewpoint: {
      title: ct.dewpoint,
      title30d: ct.dewpoint30d,
      datasets: (data) => buildTriple(data, 'out_d_avg','out_d_min','out_d_max', dl.dewpoint[0], dl.dewpoint[1], 'A','y'),
      yColor: COLOR_A, hasY1: false,
    },
    uv: {
      title: ct.uv,
      title30d: ct.uv30d,
      datasets: (data) => buildTriple(data, 'uv_avg','uv_min','uv_max', dl.uv[0], dl.uv[1], 'A','y',2),
      yColor: COLOR_A, hasY1: false,
    },
    solar: {
      title: ct.solar,
      title30d: ct.solar30d,
      datasets: (data) => buildTriple(data, 'rad_avg','rad_min','rad_max', dl.solar[0], dl.solar[1], 'A','y',0),
      yColor: COLOR_A, hasY1: false,
    },
    rain: {
      title: ct.rain,
      title30d: ct.rain30d,
      type: 'bar',
      datasets: (data) => buildBar(data, 'pr_avg', dl.rain[0], dl.rain[1], 'A','y',2),
      datasets30d: (data) => buildBar(data, 'prd_max', dl.rain30[0], dl.rain30[1], 'A','y',1),
      yColor: COLOR_A, hasY1: false,
    },
    wind: {
      title: ct.wind,
      title30d: ct.wind30d,
      datasets: (data) => [
        ...buildTriple(data, 'ws_avg','ws_min','ws_max', dl.wind[0], dl.wind[1], 'A','y'),
        {
          label: dl.windDir[0],
          data: data.map(d => d.wd_avg != null ? parseFloat(d.wd_avg).toFixed(1) : null),
          borderColor: 'transparent',
          backgroundColor: COLOR_B,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointStyle: 'circle',
          showLine: false,
          tension: 0,
          yAxisID: 'y1',
        },
      ],
      datasets30d: (data) => [
        ...buildTriple(data, 'ws_avg','ws_min','ws_max', dl.wind[0], dl.wind[1], 'A','y'),
        {
          label: dl.windDir[0],
          data: data.map(d => d.wd_avg != null ? parseFloat(d.wd_avg).toFixed(1) : null),
          borderColor: 'transparent',
          backgroundColor: COLOR_B,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointStyle: 'circle',
          showLine: false,
          tension: 0,
          yAxisID: 'y1',
        },
      ],
      yColor: COLOR_A, hasY1: true, y1Color: COLOR_B,
      y1Options: { min: 0, max: 360, ticks: { stepSize: 90, callback: v => v + '°' } },
    },
    indoor: {
      title: ct.indoor,
      title30d: ct.indoor30d,
      datasets: (data) => [
        ...buildTriple(data, 'in_t_avg','in_t_min','in_t_max', dl.inTemp[0], dl.inTemp[1], 'A','y'),
        ...buildTriple(data, 'in_h_avg','in_h_min','in_h_max', dl.inHum[0],  dl.inHum[1],  'B','y1'),
      ],
      yColor: COLOR_A, hasY1: true, y1Color: COLOR_B,
    },
    bathroom: {
      title: ct.bathroom,
      title30d: ct.bathroom30d,
      datasets: (data) => [
        ...buildTriple(data, 'in_t2_avg','in_t2_min','in_t2_max', dl.inTemp[0], dl.inTemp[1], 'A','y'),
        ...buildTriple(data, 'in_h2_avg','in_h2_min','in_h2_max', dl.inHum[0],  dl.inHum[1],  'B','y1'),
      ],
      yColor: COLOR_A, hasY1: true, y1Color: COLOR_B,
    },
    temp: {
      title: ct.temp,
      title30d: ct.temp30d,
      datasets: (data) => [
        ...buildTriple(data, 'out_t_avg','out_t_min','out_t_max', dl.temp[0], dl.temp[1], 'A','y'),
        ...buildTriple(data, 'out_h_avg','out_h_min','out_h_max', dl.humidity[0], dl.humidity[1], 'B','y1'),
      ],
      yColor: COLOR_A, hasY1: true, y1Color: COLOR_B,
    },
    humidity: {
      title: ct.humidity,
      title30d: ct.humidity30d,
      datasets: (data) => buildTriple(data, 'out_h_avg','out_h_min','out_h_max', dl.humidity[0], dl.humidity[1], 'A','y'),
      yColor: COLOR_A, hasY1: false,
    },
  };
}

// ============================================================
// STATE
// ============================================================
let dataCache = {};        // "key|day" → 24h data
let dataCache30d = {};     // "key|month" → 30d data
let activeChartKey = null;
let activeRange = '24h';   // '24h' | '30d'
let selectedDay = null;    // 'YYYY-MM-DD' | null (null = последние 24 часа)
let selectedMonth = null;  // 'YYYY-MM' | null (null = последние 30 дней)
let liveMode = true;
let refreshTimer = null;
let modalChart = null;
let CHART_CONFIGS = {};

// ============================================================
// DATE LABEL HELPERS
// ============================================================
const pad2 = n => String(n).padStart(2, '0');

function isoDay(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoMonth(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function parseIsoDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function cacheKey(cardKey, period) {
  return `${cardKey}|${period || ''}`;
}

// "2026-09-15" → "15.09.2026", "2026-09" → "09.2026"
function periodLabel(period) {
  return period ? period.split('-').reverse().join('.') : '';
}

function labelFor24h(d) {
  return d.bucket ? d.bucket.slice(11, 16) : '';
}

function labelFor30d(d) {
  if (!d.bucket) return '';
  // bucket like "2026-02-25T00:00:00" → "25.02"
  const parts = d.bucket.slice(0, 10).split('-');
  return `${parts[2]}.${parts[1]}`;
}

// ============================================================
// FETCH CURRENT
// ============================================================
async function loadCurrent() {
  try {
    const res = await fetch('/current');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    renderCurrent(d);
    setStatus(L.statusOk, true);
  } catch(e) {
    setStatus(L.statusErrCurrent, false, true);
    console.error(e);
  }
}

function renderCurrent(d) {
  const ts = d.ts ? d.ts.replace('T',' ').slice(0,19) : '';
  document.getElementById('lastUpdate').textContent = ts ? `${L.lastUpdatePrefix}${ts}` : '';

  document.getElementById('hTemp').innerHTML =
    `${parseFloat(d.out_t).toFixed(1)}<span>°C</span>`;
  document.getElementById('hHumidity').textContent =
    `${L.humidityLabel} ${d.out_h}%`;

  document.getElementById('cPressure').innerHTML =
    `${parseFloat(d.p).toFixed(1)}<span>${L.datasetLabels.pressure[1]}</span>`;
  document.getElementById('cPressureSub').textContent =
    `${(parseFloat(d.p) / 1.33322).toFixed(1)} hPa`;

  const dew = parseFloat(d.out_d).toFixed(1);
  document.getElementById('cDewpt').innerHTML = `${dew}<span>°C</span>`;
  const deficit = (parseFloat(d.out_t) - parseFloat(d.out_d)).toFixed(1);
  document.getElementById('cDewptSub').textContent = `${L.dewptDeficitLabel}: ${deficit}°C`;

  const uv = parseFloat(d.uv).toFixed(2);
  document.getElementById('cUV').innerHTML = `${uv}<span>${uvLabel(uv)}</span>`;
  document.getElementById('uvBar').style.width = `${Math.min(parseFloat(uv) / 11 * 100, 100)}%`;

  const solar = parseFloat(d.rad);
  document.getElementById('cSolar').innerHTML =
    `${Math.round(solar)}<span>${L.datasetLabels.solar[1]}</span>`;
  document.getElementById('solarBar').style.width = `${Math.min(solar / 1200 * 100, 100)}%`;

  document.getElementById('cRain').innerHTML =
    `${parseFloat(d.pr).toFixed(2)}<span>${L.datasetLabels.rain[1].split('/')[0]}</span>`;
  document.getElementById('cRainSub').textContent =
    `${L.rainDailyLabel}: ${parseFloat(d.prd).toFixed(2)} ${L.datasetLabels.rain[1].split('/')[0]}`;

  const ws = parseFloat(d.ws).toFixed(1);
  const wg = parseFloat(d.wgs).toFixed(1);
  const wd = parseInt(d.wd);
  document.getElementById('cWindspeed').innerHTML = `${ws}<span>${L.datasetLabels.wind[1]}</span>`;
  document.getElementById('cWindDir').textContent = `${degToDir(wd)} (${wd}°)`;
  document.getElementById('cWindGust').textContent = `${L.windGustLabel} ${wg} ${L.datasetLabels.wind[1]}`;
  document.getElementById('windArrow').style.transform =
    `translateX(-50%) translateY(-50%) rotate(${wd}deg)`;

  const indoorTemp = document.getElementById('cIndoorTemp');
  if (indoorTemp) {
    indoorTemp.innerHTML = `${parseFloat(d.in_t).toFixed(1)}<span>°C</span>`;
  }
  const indoorHum = document.getElementById('cIndoorHum');
  if (indoorHum) {
    indoorHum.textContent = `${L.humidityLabel} ${d.in_h}%`;
  }

  const soilTemp = document.getElementById('cSoilTemp');
  if (soilTemp) {
    soilTemp.innerHTML = `${parseFloat(d.in_t2).toFixed(1)}<span>°C</span>`;
  }
  const soilMoist = document.getElementById('cSoilMoist');
  if (soilMoist) {
    soilMoist.textContent = `${L.humidityLabel} ${d.in_h2}%`;
  }
}

// ============================================================
// FETCH 24h
// ============================================================
async function loadChartData(cardKey, day = null) {
  const fields = CHART_FIELDS[cardKey];
  if (!fields) return;

  let params = fields.map(f => `fields=${encodeURIComponent(f)}`).join('&');
  if (day) params += `&date=${day}`;
  const url = `/24h?${params}`;

  setStatus(L.statusLoading, false);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    dataCache[cacheKey(cardKey, day)] = Array.isArray(data) ? data : [data];
    setStatus(L.statusOk, true);
  } catch(e) {
    setStatus(L.statusErrLoad, false, true);
    console.error(e);
  }
}

// ============================================================
// FETCH 30d
// ============================================================
async function loadChartData30d(cardKey, month = null) {
  const fields = CHART_FIELDS_30D[cardKey];
  if (!fields) return;

  const params = fields.join(',');
  let url = `/30d?fields=${encodeURIComponent(params)}`;
  if (month) url += `&month=${month}`;

  setStatus(L.statusLoading, false);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    dataCache30d[cacheKey(cardKey, month)] = Array.isArray(data) ? data : [data];
    setStatus(L.statusOk, true);
  } catch(e) {
    setStatus(L.statusErrLoad, false, true);
    console.error(e);
  }
}

function setStatus(msg, ok, err) {
  document.getElementById('statusText').textContent = msg;
  document.getElementById('pulseDot').style.background =
    err ? 'var(--red)' : ok ? 'var(--green)' : 'var(--gold)';
}

// ============================================================
// LIVE MODE
// ============================================================
function toggleLive(on) {
  liveMode = on;
  document.getElementById('btnLive').classList.toggle('active', on);
  clearInterval(refreshTimer);
  if (on) {
    loadCurrent();
    refreshTimer = setInterval(() => {
      if (liveMode) {
        loadCurrent();
        // Обновляем график, только если он показывает текущий период
        const now = new Date();
        const period = currentPeriod();
        const isCurrent = activeRange === '24h'
          ? (period === null || period === isoDay(now))
          : (period === null || period === isoMonth(now));
        if (activeChartKey && modalChart && isCurrent) {
          const load = activeRange === '24h'
            ? loadChartData(activeChartKey, period)
            : loadChartData30d(activeChartKey, period);
          load.then(showActiveChart);
        }
      }
    }, REFRESH_INTERVAL);
  }
}

// ============================================================
// RANGE SWITCH inside modal
// ============================================================
function switchRange(range) {
  if (range === activeRange) return;
  activeRange = range;

  document.getElementById('rangeBtn24h').classList.toggle('active', range === '24h');
  document.getElementById('rangeBtn30d').classList.toggle('active', range === '30d');
  syncPeriodControls();

  showActiveChart();
}

// ============================================================
// PERIOD SELECTION inside modal
// ============================================================
function currentPeriod() {
  return activeRange === '24h' ? selectedDay : selectedMonth;
}

function syncPeriodControls() {
  const is24h = activeRange === '24h';
  const now = new Date();
  const dayInput = document.getElementById('periodDay');
  const monthInput = document.getElementById('periodMonth');
  dayInput.hidden = !is24h;
  monthInput.hidden = is24h;
  dayInput.max = isoDay(now);
  monthInput.max = isoMonth(now);
  dayInput.value = selectedDay || '';
  monthInput.value = selectedMonth || '';
  document.getElementById('periodNext').disabled = currentPeriod() === null;
}

function selectDay(value) {
  selectedDay = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  syncPeriodControls();
  showActiveChart();
}

function selectMonth(value) {
  // Браузеры без <input type="month"> показывают текстовое поле
  selectedMonth = /^\d{4}-\d{2}$/.test(value) ? value : null;
  syncPeriodControls();
  showActiveChart();
}

// Шаг на день/месяц назад (-1) или вперёд (+1).
// Шаг вперёд за текущий день/месяц возвращает к последним 24 ч / 30 дням.
function shiftPeriod(dir) {
  const now = new Date();
  if (activeRange === '24h') {
    if (selectedDay === null && dir > 0) return;
    const d = selectedDay ? parseIsoDay(selectedDay) : now;
    d.setDate(d.getDate() + dir);
    const next = isoDay(d);
    selectedDay = next > isoDay(now) ? null : next;
  } else {
    if (selectedMonth === null && dir > 0) return;
    const d = selectedMonth ? parseIsoDay(`${selectedMonth}-01`) : new Date(now.getFullYear(), now.getMonth(), 1);
    d.setMonth(d.getMonth() + dir);
    const next = isoMonth(d);
    selectedMonth = next > isoMonth(now) ? null : next;
  }
  syncPeriodControls();
  showActiveChart();
}

function clearModalChart(message) {
  if (modalChart) { modalChart.destroy(); modalChart = null; }
  document.getElementById('modalPoints').textContent = message;
}

// Показывает график для активной карточки, диапазона и периода,
// при необходимости подгружая данные
async function showActiveChart() {
  const cardKey = activeChartKey;
  if (!cardKey) return;
  const range = activeRange;
  const period = currentPeriod();
  const cache = range === '24h' ? dataCache : dataCache30d;
  const key = cacheKey(cardKey, period);

  if (!cache[key]) {
    document.getElementById('modalPoints').textContent = L.statusLoading;
    if (range === '24h') await loadChartData(cardKey, period);
    else await loadChartData30d(cardKey, period);
  }

  // Пока грузилось, пользователь мог выбрать другой период или закрыть окно
  if (cardKey !== activeChartKey || range !== activeRange || period !== currentPeriod()) return;

  const data = cache[key];
  if (!data) {
    clearModalChart(L.statusErrLoad);
  } else if (!data.length) {
    const cfg = CHART_CONFIGS[cardKey];
    document.getElementById('modalTitle').textContent =
      (range === '30d' && cfg.title30d) ? cfg.title30d : cfg.title;
    clearModalChart(period ? `${periodLabel(period)} · ${L.noDataPeriod}` : L.noDataPeriod);
  } else {
    buildModalChart(cardKey, data, range);
  }
}

// ============================================================
// MODAL CHART — единственная точка создания/пересоздания Chart
// ============================================================
function buildModalChart(cardKey, data, range) {
  const cfg = CHART_CONFIGS[cardKey];
  if (!cfg || !data || !data.length) return;

  const is30d = range === '30d';

  // Пересоздаём canvas, чтобы Chart.js не конфликтовал с предыдущим инстансом
  if (modalChart) { modalChart.destroy(); modalChart = null; }
  const oldCanvas = document.getElementById('modalChart');
  const newCanvas = document.createElement('canvas');
  newCanvas.id = 'modalChart';
  oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);

  const labels     = data.map(is30d ? labelFor30d : labelFor24h);
  const dsBuilder  = (is30d && cfg.datasets30d) ? cfg.datasets30d : cfg.datasets;
  const datasets   = dsBuilder(data);
  const chartType  = cfg.type || 'line';
  const title      = (is30d && cfg.title30d) ? cfg.title30d : cfg.title;
  const useY1      = is30d ? (cfg.hasY1_30d !== undefined ? cfg.hasY1_30d : cfg.hasY1) : cfg.hasY1;

  const period = is30d ? selectedMonth : selectedDay;
  const points = is30d ? `${data.length} ${L.chartDaysSuffix}` : `${data.length}${L.chartHoursSuffix}`;
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalPoints').textContent =
    period ? `${periodLabel(period)} · ${points}` : points;

  const maxTicks = is30d ? 30 : 24;

  const scales = {
    x: {
      ticks: { color: '#4a6fa5', font: { family: 'DM Mono', size: 10 }, maxTicksLimit: maxTicks, maxRotation: is30d ? 45 : 0 },
      grid: { color: 'rgba(79,195,247,0.05)' }
    },
    y: {
      position: 'left',
      ticks: { color: cfg.yColor, font: { family: 'DM Mono', size: 10 } },
      grid: { color: 'rgba(79,195,247,0.07)' }
    }
  };

  if (useY1) {
    const y1Ticks = cfg.y1Options && cfg.y1Options.ticks
      ? { color: cfg.y1Color, font: { family: 'DM Mono', size: 10 }, ...cfg.y1Options.ticks }
      : { color: cfg.y1Color, font: { family: 'DM Mono', size: 10 } };
    scales.y1 = {
      position: 'right',
      ticks: y1Ticks,
      grid: { drawOnChartArea: false },
      ...(cfg.y1Options ? { min: cfg.y1Options.min, max: cfg.y1Options.max } : {}),
    };
  }

  const ctx = document.getElementById('modalChart').getContext('2d');
  modalChart = new Chart(ctx, {
    type: chartType,
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 300 },
      plugins: {
        legend: { labels: { color: '#7a9cc0', font: { family: 'DM Mono', size: 11 }, boxWidth: 12 } },
        tooltip: {
          backgroundColor: 'rgba(10,22,40,0.95)',
          borderColor: 'rgba(79,195,247,0.3)', borderWidth: 1,
          titleColor: '#cfe2ff', bodyColor: '#7a9cc0',
          titleFont: { family: 'DM Mono' },
          bodyFont: { family: 'DM Mono', size: 11 },
        }
      },
      scales
    }
  });
}

async function openChart(cardKey) {
  const cfg = CHART_CONFIGS[cardKey];
  if (!cfg) return;

  // Reset range to 24h and period to the latest on open
  activeRange = '24h';
  selectedDay = null;
  selectedMonth = null;
  document.getElementById('rangeBtn24h').classList.add('active');
  document.getElementById('rangeBtn30d').classList.remove('active');
  syncPeriodControls();

  document.getElementById('modalTitle').textContent = cfg.title;
  document.getElementById('modalPoints').textContent = L.statusLoading;

  document.getElementById('chartModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  activeChartKey = cardKey;

  if (!dataCache[cacheKey(cardKey, null)]) {
    await loadChartData(cardKey);
  }
  const data = dataCache[cacheKey(cardKey, null)];
  if (!data || !data.length) { alert(L.noDataAlert); return; }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Пока грузилось, могли закрыть окно или выбрать другой период
      if (activeChartKey !== cardKey || activeRange !== '24h' || selectedDay !== null) return;
      buildModalChart(cardKey, data, '24h');
      // Prefetch 30d data in background
      if (!dataCache30d[cacheKey(cardKey, null)]) loadChartData30d(cardKey);
    });
  });
}

function closeChart() {
  document.getElementById('chartModal').classList.remove('open');
  document.body.style.overflow = '';
  if (modalChart) { modalChart.destroy(); modalChart = null; }
  activeChartKey = null;
  activeRange = '24h';
  selectedDay = null;
  selectedMonth = null;
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  CHART_CONFIGS = buildChartConfigs();

  document.getElementById('chartModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeChart();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeChart();
  });

  toggleLive(true);
});

// Явный экспорт для onclick-атрибутов в HTML
window.openChart   = openChart;
window.closeChart  = closeChart;
window.switchRange = switchRange;
window.shiftPeriod = shiftPeriod;
window.selectDay   = selectDay;
window.selectMonth = selectMonth;
window.toggleLive  = toggleLive;
