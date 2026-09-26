// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: cloud-sun-rain;

// Weather Graph Widget — current device location
// Medium widget: dual-axis graph of temperature + POP
// Temperature: gray line (past), red line (forecast), red circles at daily hi/lo
// POP: filled area — blue for rain, purple for snow
// Background: light gray (day), slightly darker (night)
// API: Open-Meteo (free, no key required)

// WMO weather codes indicating snow-type precipitation
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

const MS_DAY  = 86400000;
const MS_HOUR = 3600000;

// ── Helpers ────────────────────────────────────────────────────────────────

// Parse "2026-03-05T14:00" to a local-time Date (avoids UTC-shift issues)
function parseLocalTime(str) {
  const [dp, tp] = str.split("T");
  const [yr, mo, dy] = dp.split("-").map(Number);
  const [hr, mn] = (tp || "00:00").split(":").map(Number);
  return new Date(yr, mo - 1, dy, hr, mn || 0);
}

// Format a Date as "YYYY-MM-DD" for matching against API daily.time strings
function dateStr(date) {
  const yr = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const dy = String(date.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

function todayMidnight() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayLabel(date) {
  const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return `${DAYS[date.getDay()]} ${date.getDate()}`;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Draw a horizontal dashed/dotted line by manually repeating short segments.
// dashLen and gapLen are in canvas pixels.
function drawDashedLine(ctx, x1, y, x2, dashLen, gapLen, color, lineWidth) {
  ctx.setStrokeColor(color);
  ctx.setLineWidth(lineWidth);
  let x = x1;
  while (x < x2) {
    const segEnd = Math.min(x + dashLen, x2);
    const p = new Path();
    p.move(new Point(x, y));
    p.addLine(new Point(segEnd, y));
    ctx.addPath(p);
    ctx.strokePath();
    x += dashLen + gapLen;
  }
}

// ── API ────────────────────────────────────────────────────────────────────

async function fetchWeather(lat, lon) {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lon}` +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset" +
    "&hourly=precipitation_probability,precipitation,weather_code,temperature_2m" +
    "&current=temperature_2m,precipitation,weather_code" +
    "&timezone=auto" +
    "&past_days=1&forecast_days=4" +
    "&wind_speed_unit=mph&temperature_unit=fahrenheit&precipitation_unit=inch";
  return new Request(url).loadJSON();
}

// ── Widget ─────────────────────────────────────────────────────────────────

async function buildWidget() {
  // Resolve device location first — kilometer accuracy is plenty for weather
  Location.setAccuracyToKilometer();
  let coords;
  try {
    coords = await Location.current();
  } catch (e) {
    const w = new ListWidget();
    const t = w.addText("Location unavailable");
    t.textColor = Color.gray();
    t.font = Font.systemFont(14);
    return w;
  }

  // Fetch weather and reverse-geocode in parallel
  let data, locationName;
  try {
    const [weatherData, geoResults] = await Promise.all([
      fetchWeather(coords.latitude, coords.longitude),
      Location.reverseGeocode(coords.latitude, coords.longitude),
    ]);
    data         = weatherData;
    locationName = geoResults?.[0]?.locality || "Current Location";
  } catch (e) {
    const w = new ListWidget();
    const t = w.addText("Weather unavailable");
    t.textColor = Color.gray();
    t.font = Font.systemFont(14);
    return w;
  }

  const now        = new Date();
  const todayStart = todayMidnight();
  const GRAPH_DAYS = 4; // today + 3 more

  const graphStart = todayStart;
  const graphEnd   = new Date(+todayStart + GRAPH_DAYS * MS_DAY);
  const totalMs    = +graphEnd - +graphStart;

  // ── Canvas layout ──────────────────────────────────────────────────────
  // Canvas is ~2.33:1 to match medium widget aspect ratio.
  // All sizes are in canvas pixels (~2× logical points for crisp rendering).
  const W  = 700, H  = 320;
  const PL = 10,  PR = 10,  PT = 10, PB = 88;
  const GX = PL,  GY = PT;
  const GW = W - PL - PR;
  const GH = H - PT - PB;
  const GB = GY + GH; // bottom of graph area (y coord)

  // x: time → canvas x
  const tx = (t) => GX + ((+t - +graphStart) / totalMs) * GW;

  // ── Process hourly data ────────────────────────────────────────────────
  const htimes = data.hourly.time.map(parseLocalTime);
  const htemp  = data.hourly.temperature_2m;
  const hpop   = data.hourly.precipitation_probability;
  const hcode  = data.hourly.weather_code;

  // Indices within the graph time window
  const rangeIdx = [];
  for (let i = 0; i < htimes.length; i++) {
    if (htimes[i] >= graphStart && htimes[i] < graphEnd) rangeIdx.push(i);
  }

  // Temperature Y scale — span all hourly temps in range with small margin
  const temps = rangeIdx.map((i) => htemp[i]).filter((v) => v != null);
  const tMin  = Math.min(...temps) - 4;
  const tMax  = Math.max(...temps) + 4;
  // y: temperature → canvas y (higher temp = lower y value)
  const ty = (temp) => GY + GH * (1 - (temp - tMin) / (tMax - tMin));

  // POP Y scale — 0% at bottom, 100% at top of graph area
  const py = (pop) => GB - (pop / 100) * GH;

  // ── DrawContext ────────────────────────────────────────────────────────
  const ctx = new DrawContext();
  ctx.size               = new Size(W, H);
  ctx.opaque             = true;
  ctx.respectScreenScale = false; // fixed pixel canvas; scales to widget

  // ── 1. Daytime background (very light gray) ───────────────────────────
  ctx.setFillColor(new Color("#f0f0f0"));
  ctx.fillRect(new Rect(0, 0, W, H));

  // ── 2. Night shading (slightly darker) ───────────────────────────────
  if (data.daily.sunrise && data.daily.sunset) {
    const nightColor = new Color("#d8d8d8");
    const gs = +graphStart, ge = +graphEnd;

    for (let d = 0; d < data.daily.time.length; d++) {
      const dayMs  = parseLocalTime(data.daily.time[d] + "T00:00").getTime();
      const sunUp  = parseLocalTime(data.daily.sunrise[d]).getTime();
      const sunDn  = parseLocalTime(data.daily.sunset[d]).getTime();
      const nextDay = dayMs + MS_DAY;

      // Pre-dawn: midnight → sunrise
      const a1 = clamp(dayMs, gs, ge), b1 = clamp(sunUp, gs, ge);
      if (b1 > a1) {
        ctx.setFillColor(nightColor);
        ctx.fillRect(new Rect(tx(a1), GY, tx(b1) - tx(a1), GH));
      }

      // Post-dusk: sunset → midnight
      const a2 = clamp(sunDn, gs, ge), b2 = clamp(nextDay, gs, ge);
      if (b2 > a2) {
        ctx.setFillColor(nightColor);
        ctx.fillRect(new Rect(tx(a2), GY, tx(b2) - tx(a2), GH));
      }
    }
  }

  // ── 3a. POP fill pass ─────────────────────────────────────────────────
  for (let k = 0; k < rangeIdx.length - 1; k++) {
    const i    = rangeIdx[k], j = rangeIdx[k + 1];
    const pop1 = hpop[i] ?? 0, pop2 = hpop[j] ?? 0;
    if (pop1 === 0 && pop2 === 0) continue;

    const snow = SNOW_CODES.has(hcode[i]);
    const x1 = tx(htimes[i]), x2 = tx(htimes[j]);
    const y1 = py(pop1),      y2 = py(pop2);

    const fillPath = new Path();
    fillPath.move(new Point(x1, GB));
    fillPath.addLine(new Point(x1, y1));
    fillPath.addLine(new Point(x2, y2));
    fillPath.addLine(new Point(x2, GB));
    fillPath.closeSubpath();
    ctx.setFillColor(snow ? new Color("#c090e0", 0.5) : new Color("#80b8e0", 0.5));
    ctx.addPath(fillPath);
    ctx.fillPath();
  }

  // ── 3b. Horizontal temperature reference lines ────────────────────────
  // Decade lines (every 10°) — gray dashed, dash:gap = 1:2
  const decadeStart = Math.ceil(tMin / 10) * 10;
  const decadeEnd   = Math.floor(tMax / 10) * 10;
  for (let temp = decadeStart; temp <= decadeEnd; temp += 10) {
    const y = ty(temp);
    drawDashedLine(ctx, GX, y, GX + GW, 8, 16, new Color("#aaaaaa"), 1);
  }

  // Freezing line (32°) — dark blue dotted, only when in range
  if (tMin <= 32 && 32 <= tMax) {
    const y = ty(32);
    drawDashedLine(ctx, GX, y, GX + GW, 3, 6, new Color("#003a8c"), 2);
  }

  // ── 3c. POP stroke pass ───────────────────────────────────────────────
  for (let k = 0; k < rangeIdx.length - 1; k++) {
    const i    = rangeIdx[k], j = rangeIdx[k + 1];
    const pop1 = hpop[i] ?? 0, pop2 = hpop[j] ?? 0;
    if (pop1 === 0 && pop2 === 0) continue;

    const snow = SNOW_CODES.has(hcode[i]);
    const strokePath = new Path();
    strokePath.move(new Point(tx(htimes[i]), py(pop1)));
    strokePath.addLine(new Point(tx(htimes[j]), py(pop2)));
    ctx.setStrokeColor(snow ? new Color("#8040c0", 0.9) : new Color("#3080c0", 0.9));
    ctx.setLineWidth(2.5);
    ctx.addPath(strokePath);
    ctx.strokePath();
  }

  // ── 4. Day boundary vertical lines ────────────────────────────────────
  // Drawn after POP fill so they're visible on top of the fill area
  for (let d = 1; d < GRAPH_DAYS; d++) {
    const x = tx(+todayStart + d * MS_DAY);
    const p = new Path();
    p.move(new Point(x, GY));
    p.addLine(new Point(x, GB));
    ctx.setStrokeColor(new Color("#888888"));
    ctx.setLineWidth(1);
    ctx.addPath(p);
    ctx.strokePath();
  }

  // ── 5. Actual temperature — gray line (today midnight → now) ─────────
  {
    const past = rangeIdx.filter((i) => htimes[i] <= now);
    if (past.length > 0) {
      const path = new Path();
      path.move(new Point(tx(htimes[past[0]]), ty(htemp[past[0]])));
      for (let k = 1; k < past.length; k++) {
        path.addLine(new Point(tx(htimes[past[k]]), ty(htemp[past[k]])));
      }
      // Terminate exactly at current time/temperature
      path.addLine(new Point(tx(now), ty(data.current.temperature_2m)));
      ctx.setStrokeColor(new Color("#888888"));
      ctx.setLineWidth(2.5);
      ctx.addPath(path);
      ctx.strokePath();
    }
  }

  // ── 6. Forecast temperature — red line (now → end of range) ──────────
  {
    const future = rangeIdx.filter((i) => htimes[i] >= now);
    if (future.length > 0) {
      const path = new Path();
      // Start connected to the gray line at current time/temp
      path.move(new Point(tx(now), ty(data.current.temperature_2m)));
      for (const i of future) {
        path.addLine(new Point(tx(htimes[i]), ty(htemp[i])));
      }
      ctx.setStrokeColor(new Color("#cc3333"));
      ctx.setLineWidth(2.5);
      ctx.addPath(path);
      ctx.strokePath();
    }
  }

  // ── Pre-compute daily hi/lo hour indices ──────────────────────────────
  // High for day N = peak temp from sunrise[N] → sunrise[N+1] (dawn-to-dawn)
  // Low  for day N = trough between peakTime[N] and peakTime[N+1]
  // Shared by §7 (graph circles) and §10 (axis labels).
  const sunrises = (data.daily.sunrise || []).map(parseLocalTime);
  const dayKeys  = data.daily.time;
  const dayHiIdx = new Array(dayKeys.length).fill(-1); // index into htimes/htemp
  const dayLoIdx = new Array(dayKeys.length).fill(-1);

  // Pass 1: dawn-to-dawn high
  for (let d = 0; d < dayKeys.length; d++) {
    const dawnStart = sunrises[d];
    if (!dawnStart) continue;
    const dawnEnd = sunrises[d + 1] ?? new Date(+dawnStart + MS_DAY);
    let best = -Infinity, idx = -1;
    for (let i = 0; i < htimes.length; i++) {
      if (htimes[i] >= dawnStart && htimes[i] < dawnEnd && htemp[i] != null && htemp[i] > best) {
        best = htemp[i]; idx = i;
      }
    }
    dayHiIdx[d] = idx;
  }

  // Pass 2: trough between consecutive highs → overnight low
  for (let d = 0; d < dayKeys.length; d++) {
    const hiIdx = dayHiIdx[d];
    if (hiIdx < 0) continue;
    const nextHiIdx = d + 1 < dayKeys.length ? dayHiIdx[d + 1] : -1;
    const tStart = htimes[hiIdx];
    const tEnd   = nextHiIdx >= 0 ? htimes[nextHiIdx]
                 : sunrises[d + 1] ?? new Date(+sunrises[d] + MS_DAY);
    let best = Infinity, idx = -1;
    for (let i = 0; i < htimes.length; i++) {
      if (htimes[i] >= tStart && htimes[i] <= tEnd && htemp[i] != null && htemp[i] < best) {
        best = htemp[i]; idx = i;
      }
    }
    dayLoIdx[d] = idx;
  }

  // ── 7. Daily high/low circles ─────────────────────────────────────────
  // Drawn on both the gray (past) and red (forecast) portions of the line,
  // so the actual peak/trough times are always marked even if already past.
  const CR = 7; // circle radius in canvas pixels
  for (let d = 0; d < dayKeys.length; d++) {
    const candidates = [...new Set([dayHiIdx[d], dayLoIdx[d]])];
    for (const idx of candidates) {
      if (idx < 0) continue;
      if (htimes[idx] < graphStart || htimes[idx] >= graphEnd) continue;
      const cx = tx(htimes[idx]);
      const cy = ty(htemp[idx]);
      ctx.setFillColor(Color.white());
      ctx.fillEllipse(new Rect(cx - CR, cy - CR, CR * 2, CR * 2));
      const pastMarker = htimes[idx] <= now;
      ctx.setStrokeColor(pastMarker ? new Color("#888888") : new Color("#cc3333"));
      ctx.setLineWidth(2.5);
      ctx.strokeEllipse(new Rect(cx - CR, cy - CR, CR * 2, CR * 2));
    }
  }

  // ── 7b. Current-time dot + temperature annotation ─────────────────────
  {
    const cx      = tx(now);
    const cy      = ty(data.current.temperature_2m);
    const dotR    = 6;
    const currTemp = Math.round(data.current.temperature_2m);
    const label   = `${currTemp}°`;
    const lblW    = 70, lblH = 34;
    const margin  = 5; // min px from graph top before flipping below

    // Black dot on top of the temperature lines
    ctx.setFillColor(Color.black());
    ctx.fillEllipse(new Rect(cx - dotR, cy - dotR, dotR * 2, dotR * 2));

    // Annotation: prefer above, flip below if too close to top edge
    const aboveY = cy - dotR - 6 - lblH;
    const labelY = aboveY >= GY + margin ? aboveY : cy + dotR + 6;

    // drawTextInRect left-aligns, so anchor at ~1/4 of the rect width
    // rather than 1/2 so the text visually centers over the dot.
    const labelX = clamp(cx - Math.round(lblW / 4), GX, GX + GW - lblW);

    ctx.setFont(Font.systemFont(27));
    ctx.setTextColor(Color.black());
    ctx.drawTextInRect(label, new Rect(labelX, labelY, lblW, lblH));
  }

  // ── 8. X-axis minor ticks (4 am, 8 am, 12 pm, 4 pm, 8 pm) — face up ─
  for (let d = 0; d < GRAPH_DAYS; d++) {
    for (const h of [4, 8, 12, 16, 20]) {
      const tMs = +todayStart + (d * 24 + h) * MS_HOUR;
      if (tMs < +graphStart || tMs >= +graphEnd) continue;
      const x = tx(tMs);
      const p = new Path();
      p.move(new Point(x, GB));
      p.addLine(new Point(x, GB - 8));
      ctx.setStrokeColor(new Color("#777777"));
      ctx.setLineWidth(1.5);
      ctx.addPath(p);
      ctx.strokePath();
    }
  }

  // ── 9. Bottom axis line ────────────────────────────────────────────────
  {
    const p = new Path();
    p.move(new Point(GX, GB));
    p.addLine(new Point(GX + GW, GB));
    ctx.setStrokeColor(new Color("#999999"));
    ctx.setLineWidth(1.5);
    ctx.addPath(p);
    ctx.strokePath();
  }

  // ── 10. Day labels + hi/lo (centered within each day's section) ──────
  // hi/lo values come from dayHiIdx / dayLoIdx pre-computed before §7.
  const dawnHiLo = {};
  for (let d = 0; d < dayKeys.length; d++) {
    const hi = dayHiIdx[d] >= 0 ? htemp[dayHiIdx[d]] : null;
    const lo = dayLoIdx[d] >= 0 ? htemp[dayLoIdx[d]] : null;
    if (hi !== null) dawnHiLo[dayKeys[d]] = { hi, lo: lo ?? hi };
  }

  // Build section x-boundary array
  const secX = [GX];
  for (let d = 1; d < GRAPH_DAYS; d++) secX.push(tx(+todayStart + d * MS_DAY));
  secX.push(GX + GW);

  for (let d = 0; d < GRAPH_DAYS; d++) {
    const midX   = (secX[d] + secX[d + 1]) / 2;
    const sectionDate = new Date(+todayStart + d * MS_DAY);
    const label  = d === 0 ? "TODAY" : dayLabel(sectionDate);

    // Look up dawn-to-dawn hi/lo for this day
    const dsKey = dateStr(sectionDate);
    let hiLoText = "";
    if (dawnHiLo[dsKey]) {
      const hi = Math.round(dawnHiLo[dsKey].hi);
      const lo = Math.round(dawnHiLo[dsKey].lo);
      hiLoText = `${hi}° | ${lo}°`;
    }

    // Line 1: day name
    ctx.setFont(Font.boldSystemFont(30));
    ctx.setTextColor(new Color("#444444"));
    ctx.drawTextInRect(label, new Rect(midX - 60, GB + 8, 120, 38));

    // Line 2: high | low
    // Today's section is shifted right to avoid the widget's rounded corner
    if (hiLoText) {
      const hiLoX = d === 0 ? midX - 55 : d === GRAPH_DAYS - 1 ? midX - 60 : midX - 75;
      ctx.setFont(Font.systemFont(27));
      ctx.setTextColor(new Color("#666666"));
      ctx.drawTextInRect(hiLoText, new Rect(hiLoX, GB + 48, 150, 34));
    }
  }

  // ── 11. Location name (upper-right, on top of graph) ──────────────────
  ctx.setFont(Font.systemFont(27));
  ctx.setTextColor(Color.black());
  ctx.setTextAlignedRight();
  ctx.drawTextInRect(locationName, new Rect(GX + GW - 314, GY + 6, 300, 34));

  // ── Assemble widget ────────────────────────────────────────────────────
  const widget = new ListWidget();
  widget.setPadding(0, 0, 0, 0);
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  widget.backgroundImage = ctx.getImage();
  return widget;
}

// ── Entry point ────────────────────────────────────────────────────────────

const widget = await buildWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  widget.presentMedium();
}
Script.complete();
