/*
 * Glass Home - weather under the clock: the temperature now, today's high and
 * low, and the next 7 days.
 *
 * Data comes from Open-Meteo (free, no account or key, no tracking; data under
 * CC BY 4.0, credited in the card). The TV fetches it directly every 30
 * minutes. The last good answer is kept in localStorage, so the card appears
 * at once after a restart and survives short outages. Nothing from the network
 * is inserted as HTML: numbers are rounded, labels come from the table below,
 * and the icons are drawn here.
 *
 * Selecting the card (Up from the dock, then OK) opens a details panel:
 * feels-like, humidity, wind, UV, rain, sunrise and sunset, the next 24 hours
 * and the week with temperature ranges (renderDetail below).
 *
 * GH.Weather.now() gives the conditions to the rest of the app (js/sky.js:
 * the weather over the photos and the rain alert); onUpdate(fn) is told
 * whenever a forecast arrives. 15-minute precipitation (minutely_15) gives
 * when the next rain starts.
 *
 * Preview (desktop browser): add ?wx=mock to use built-in sample data.
 */
(function () {
  'use strict';
  var GH = window.GH || {};
  var cfg = GH.config && GH.config.weather;
  var root = document.getElementById('weather');
  var mockWx = !!(GH.config && GH.config.preview && GH.query && GH.query.wx === 'mock');
  // Off until a location is set in config.js (?wx=mock in preview shows sample data).
  if (!cfg || !root) return;
  if (!mockWx && (cfg.enabled === false || (!cfg.latitude && !cfg.longitude))) return;

  var KEY = 'gh.weather.v2';
  var HIDE_AFTER = 12 * 3600 * 1000;    // older than this: hide rather than mislead
  var NOW_STALE = 3 * 3600 * 1000;      // older than this: drop the "now" temperature
  var REFRESH = cfg.refreshMs || 30 * 60 * 1000;
  var mock = !!(GH.config.preview && GH.query && GH.query.wx === 'mock');
  var last = null;
  var timer = null;
  var uid = 0;

  var dayFmt = null;
  try { dayFmt = new Intl.DateTimeFormat(GH.config.locale || undefined, { weekday: 'short' }); } catch (e) { /* fallback below */ }
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // WMO weather codes used by Open-Meteo -> [day label, night label, icon]
  var CODES = {
    0: ['Sunny', 'Clear', 'clear'],
    1: ['Mostly sunny', 'Mostly clear', 'clear'],
    2: ['Partly cloudy', 'Partly cloudy', 'partly'],
    3: ['Cloudy', 'Cloudy', 'cloud'],
    45: ['Fog', 'Fog', 'fog'],
    48: ['Fog', 'Fog', 'fog'],
    51: ['Light drizzle', 'Light drizzle', 'drizzle'],
    53: ['Drizzle', 'Drizzle', 'drizzle'],
    55: ['Drizzle', 'Drizzle', 'drizzle'],
    56: ['Freezing drizzle', 'Freezing drizzle', 'drizzle'],
    57: ['Freezing drizzle', 'Freezing drizzle', 'drizzle'],
    61: ['Light rain', 'Light rain', 'rain'],
    63: ['Rain', 'Rain', 'rain'],
    65: ['Heavy rain', 'Heavy rain', 'rain'],
    66: ['Freezing rain', 'Freezing rain', 'rain'],
    67: ['Freezing rain', 'Freezing rain', 'rain'],
    71: ['Light snow', 'Light snow', 'snow'],
    73: ['Snow', 'Snow', 'snow'],
    75: ['Heavy snow', 'Heavy snow', 'snow'],
    77: ['Snow', 'Snow', 'snow'],
    80: ['Showers', 'Showers', 'showers'],
    81: ['Showers', 'Showers', 'showers'],
    82: ['Heavy showers', 'Heavy showers', 'rain'],
    85: ['Snow showers', 'Snow showers', 'snow'],
    86: ['Snow showers', 'Snow showers', 'snow'],
    95: ['Storms', 'Storms', 'storm'],
    96: ['Storms with hail', 'Storms with hail', 'storm'],
    99: ['Storms with hail', 'Storms with hail', 'storm']
  };

  // ---------- icons (64 x 64, filled, like Apple's multicolour symbols) ----------
  var SUN = '#FFCC48';
  var MOON = '#F2EDD5';
  var RAIN = '#68C4FF';
  var BOLT = '#FFD84D';

  function n(v) { return String(Math.round(v * 100) / 100); }

  function sunShape(cx, cy, r, r1, r2) {
    var rays = '';
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      rays += '<line x1="' + n(cx + r1 * Math.cos(a)) + '" y1="' + n(cy + r1 * Math.sin(a)) +
        '" x2="' + n(cx + r2 * Math.cos(a)) + '" y2="' + n(cy + r2 * Math.sin(a)) + '"/>';
    }
    return '<g stroke="' + SUN + '" stroke-width="3.6" stroke-linecap="round">' + rays + '</g>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + SUN + '"/>';
  }

  function moonShape(cx, cy, r) {
    var id = 'wxm' + (++uid);
    return '<defs><mask id="' + id + '"><rect width="64" height="64" fill="#fff"/>' +
      '<circle cx="' + n(cx + r * 0.6) + '" cy="' + n(cy - r * 0.5) + '" r="' + n(r * 0.82) + '" fill="#000"/></mask></defs>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + MOON + '" mask="url(#' + id + ')"/>';
  }

  // A cloud spanning x 14-54, y 18-48 before the shift.
  function cloudShape(dx, dy) {
    return '<g fill="#fff" transform="translate(' + dx + ' ' + dy + ')">' +
      '<circle cx="24" cy="38" r="10"/><circle cx="34" cy="31" r="13"/><circle cx="45" cy="39" r="9"/>' +
      '<rect x="24" y="38" width="21" height="10"/></g>';
  }

  function strokes(color, width, segs) {
    var s = '';
    for (var i = 0; i < segs.length; i++) {
      var p = segs[i];
      s += '<line x1="' + p[0] + '" y1="' + p[1] + '" x2="' + p[2] + '" y2="' + p[3] + '"/>';
    }
    return '<g stroke="' + color + '" stroke-width="' + width + '" stroke-linecap="round">' + s + '</g>';
  }

  function dots(color, r, pts) {
    var s = '';
    for (var i = 0; i < pts.length; i++) s += '<circle cx="' + pts[i][0] + '" cy="' + pts[i][1] + '" r="' + r + '"/>';
    return '<g fill="' + color + '">' + s + '</g>';
  }

  function iconSvg(kind, night) {
    var b;
    switch (kind) {
      case 'clear':
        b = night ? moonShape(31, 33, 17) : sunShape(32, 32, 11, 17, 23);
        break;
      case 'partly':
        b = (night ? moonShape(22, 22, 11) : sunShape(23, 22, 8, 12.5, 17)) + cloudShape(4, 8);
        break;
      case 'fog':
        b = strokes('rgba(255,255,255,0.92)', 4.5, [[12, 22, 46, 22], [18, 32, 52, 32], [12, 42, 44, 42], [22, 52, 50, 52]]);
        break;
      case 'drizzle':
        b = cloudShape(-2, -7) + strokes(RAIN, 4, [[22, 46, 21, 49], [32, 46, 31, 49], [42, 46, 41, 49], [27, 53, 26, 56], [37, 53, 36, 56]]);
        break;
      case 'rain':
        b = cloudShape(-2, -7) + strokes(RAIN, 4, [[23, 46, 20, 56], [32, 46, 29, 56], [41, 46, 38, 56]]);
        break;
      case 'showers':
        b = (night ? moonShape(19, 17, 9) : sunShape(19, 17, 6.5, 10.5, 14.5)) + cloudShape(2, -3) +
          strokes(RAIN, 4, [[28, 50, 25, 59], [39, 50, 36, 59]]);
        break;
      case 'storm':
        b = cloudShape(-2, -8) + '<polygon points="34,38 26,51 32,51 28,62 41,47 35,47 39,38" fill="' + BOLT + '"/>';
        break;
      case 'snow':
        b = cloudShape(-2, -7) + dots('#fff', 2.8, [[22, 49], [32, 53], [42, 49], [27, 58], [37, 58]]);
        break;
      default:
        b = cloudShape(-2, -1);
    }
    return '<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false">' + b + '</svg>';
  }

  // ---------- data ----------
  function readCache() {
    try { return JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function writeCache(rec) {
    try { window.localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) { /* storage full or off */ }
  }

  function num(v) { return typeof v === 'number' && isFinite(v); }
  function deg(v) { return (Math.round(v) || 0) + '°'; }

  function valid(j) {
    if (!j || !j.current || !j.daily) return false;
    var d = j.daily;
    if (!d.time || !d.time.length || !d.weather_code || !d.temperature_2m_max || !d.temperature_2m_min) return false;
    for (var i = 0; i < d.time.length; i++) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.time[i]))) return false;
    }
    return num(j.current.temperature_2m);
  }

  function localDay(dt) {
    return dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2);
  }

  function weekday(ymd) {
    var p = ymd.split('-');
    var dt = new Date(+p[0], +p[1] - 1, +p[2]);
    try { if (dayFmt) return dayFmt.format(dt).replace(/\.$/, ''); } catch (e) { /* fall through */ }
    return DAYS[dt.getDay()];
  }

  function info(code) { return CODES[code] || ['', '', 'cloud']; }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render() {
    var rec = last;
    var age = rec ? Date.now() - rec.at : Infinity;
    if (!rec || !valid(rec.data) || age > HIDE_AFTER) { root.classList.remove('on'); return; }
    var j = rec.data;
    var d = j.daily;
    var i0 = d.time.indexOf(localDay(new Date()));
    if (i0 < 0) { root.classList.remove('on'); return; }

    // Now: icon, temperature, condition, today's high and low.
    var c = j.current;
    var night = c.is_day === 0;
    var nowCode = num(c.weather_code) ? c.weather_code : d.weather_code[i0];
    var nowInfo = info(nowCode);
    var showNow = age <= NOW_STALE;
    document.getElementById('wx-now-icon').innerHTML = iconSvg(showNow ? nowInfo[2] : info(d.weather_code[i0])[2], showNow && night);
    document.getElementById('wx-now-temp').textContent = showNow ? deg(c.temperature_2m) : '';
    var parts = [];
    var label = showNow ? nowInfo[night ? 1 : 0] : info(d.weather_code[i0])[0];
    if (label) parts.push(label);
    if (num(d.temperature_2m_max[i0]) && num(d.temperature_2m_min[i0])) {
      parts.push('H ' + deg(d.temperature_2m_max[i0]) + '  L ' + deg(d.temperature_2m_min[i0]));
    }
    document.getElementById('wx-now-text').textContent = parts.join('  ·  ');

    // The next 7 days.
    var row = document.getElementById('wx-days');
    row.textContent = '';
    var rain = d.precipitation_probability_max || [];
    for (var i = i0 + 1; i < d.time.length && i <= i0 + 7; i++) {
      var day = el('div', 'wx-day');
      day.appendChild(el('div', 'wx-dname', weekday(String(d.time[i]))));
      var ic = el('div', 'wx-icon');
      ic.innerHTML = iconSvg(info(d.weather_code[i])[2], false);
      day.appendChild(ic);
      day.appendChild(el('div', 'wx-hi', num(d.temperature_2m_max[i]) ? deg(d.temperature_2m_max[i]) : '–'));
      day.appendChild(el('div', 'wx-lo', num(d.temperature_2m_min[i]) ? deg(d.temperature_2m_min[i]) : ''));
      day.appendChild(el('div', 'wx-rain', num(rain[i]) && rain[i] >= 20 ? Math.round(rain[i]) + '%' : ''));
      row.appendChild(day);
    }
    document.getElementById('wx-place').textContent = cfg.place || '';
    root.classList.toggle('stale-now', !showNow);
    root.classList.add('on');
  }

  function url() {
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(cfg.latitude) +
      '&longitude=' + encodeURIComponent(cfg.longitude) +
      '&current=temperature_2m,weather_code,is_day,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m' +
      '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
      '&minutely_15=precipitation,weather_code&forecast_minutely_15=16' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,sunrise,sunset' +
      '&timezone=' + encodeURIComponent(cfg.timezone || 'auto') + '&forecast_days=8';
  }

  function sample() {
    var codes = [2, 61, 80, 3, 1, 0, 2, 61];
    var hi = [21, 18, 17, 19, 22, 24, 23, 20];
    var lo = [12, 11, 10, 9, 11, 13, 14, 12];
    var rain = [10, 70, 80, 30, 10, 0, 20, 60];
    var t = [];
    var base = new Date();
    for (var i = 0; i < 8; i++) t.push(localDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)));
    var ht = [], htemp = [], hcode = [], hrain = [], hday = [];
    var h0 = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    for (var h = 0; h < 48; h++) {
      var dt = new Date(h0.getTime() + h * 3600 * 1000);
      ht.push(localDay(dt) + 'T' + ('0' + dt.getHours()).slice(-2) + ':00');
      htemp.push(14 + 6 * Math.sin((dt.getHours() - 9) / 24 * 2 * Math.PI));
      hcode.push(dt.getHours() > 15 && dt.getHours() < 20 ? 61 : 2);
      hrain.push(dt.getHours() > 15 && dt.getHours() < 20 ? 60 : 10);
      hday.push(dt.getHours() >= 6 && dt.getHours() < 19 ? 1 : 0);
    }
    return {
      current: { temperature_2m: 18.0, weather_code: 2, is_day: 1, apparent_temperature: 17.2, relative_humidity_2m: 72,
        wind_speed_10m: 14, wind_direction_10m: 135 },
      hourly: { time: ht, temperature_2m: htemp, weather_code: hcode, precipitation_probability: hrain, is_day: hday },
      daily: { time: t, weather_code: codes, temperature_2m_max: hi, temperature_2m_min: lo, precipitation_probability_max: rain,
        precipitation_sum: [0.4, 6, 9, 1, 0, 0, 0.2, 4], uv_index_max: [6, 3, 2, 5, 7, 8, 7, 4],
        sunrise: t.map(function (x) { return x + 'T05:41'; }), sunset: t.map(function (x) { return x + 'T18:52'; }) }
    };
  }

  var loading = false;
  function load() {
    if (mock) { last = { at: Date.now(), data: sample() }; render(); notify(); return; }
    if (loading || !window.fetch) { render(); notify(); return; }
    loading = true;
    var ctrl = window.AbortController ? new window.AbortController() : null;
    var guard = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    var opts = { cache: 'no-store', credentials: 'omit' };
    if (ctrl) opts.signal = ctrl.signal;
    window.fetch(url(), opts)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        if (!valid(j)) throw new Error('unexpected weather data');
        last = { at: Date.now(), data: j };
        writeCache(last);
      })
      .catch(function () { /* keep the cached forecast while it is recent */ })
      .then(function () {
        loading = false;
        if (guard) clearTimeout(guard);
        render();
        notify();
      });
  }

  function startTimer() {
    clearInterval(timer);
    timer = setInterval(load, REFRESH);
  }

  // ---------- details panel ----------
  var hourFmt = null;
  try { hourFmt = new Intl.DateTimeFormat(GH.config.locale || undefined, { hour: 'numeric', minute: '2-digit' }); } catch (e) { /* fallback */ }

  // "2026-10-21T05:41" -> a local Date (Open-Meteo gives local times with timezone=auto)
  function parseLocal(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  }
  function clock(dt) {
    if (!dt) return '–';
    try { if (hourFmt) return hourFmt.format(dt).replace(/\s?([AP])\.?M\.?$/i, function (x, p) { return p.toLowerCase() === 'a' ? 'am' : 'pm'; }); } catch (e) { /* fall through */ }
    return dt.getHours() + ':' + ('0' + dt.getMinutes()).slice(-2);
  }
  function hourLabel(dt) {
    var h = dt.getHours();
    var t = clock(dt);
    return /[ap]m$/.test(t) ? ((h % 12) || 12) + (h < 12 ? ' am' : ' pm') : t;
  }
  function compass(d) {
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8];
  }
  function uvWord(u) { return u < 3 ? 'Low' : u < 6 ? 'Moderate' : u < 8 ? 'High' : u < 11 ? 'Very high' : 'Extreme'; }

  function stat(box, title, value, note) {
    var s = el('div', 'wxd-stat');
    s.appendChild(el('div', 'wxd-stat-title', title));
    s.appendChild(el('div', 'wxd-stat-value', value));
    if (note) s.appendChild(el('div', 'wxd-stat-note', note));
    box.appendChild(s);
  }

  // Fills `box` with the details; returns false when there is no forecast to show.
  function renderDetail(box) {
    box.textContent = '';
    var rec = last;
    if (!rec || !valid(rec.data) || Date.now() - rec.at > HIDE_AFTER) return false;
    var j = rec.data, c = j.current, d = j.daily, hr = j.hourly;
    var i0 = d.time.indexOf(localDay(new Date()));
    if (i0 < 0) return false;
    var night = c.is_day === 0;
    var nowInfo = info(num(c.weather_code) ? c.weather_code : d.weather_code[i0]);

    // header: place, big icon and temperature, condition, high/low, feels like
    var head = el('div', 'wxd-head');
    var big = el('div', 'wxd-icon');
    big.innerHTML = iconSvg(nowInfo[2], night);
    head.appendChild(big);
    var ht = el('div', 'wxd-headtext');
    ht.appendChild(el('div', 'wxd-place', cfg.place || 'Weather'));
    ht.appendChild(el('div', 'wxd-temp', deg(c.temperature_2m)));
    var sub = [nowInfo[night ? 1 : 0]];
    if (num(d.temperature_2m_max[i0])) sub.push('H ' + deg(d.temperature_2m_max[i0]) + '  L ' + deg(d.temperature_2m_min[i0]));
    ht.appendChild(el('div', 'wxd-cond', sub.join('  ·  ')));
    head.appendChild(ht);
    box.appendChild(head);

    // stats
    var stats = el('div', 'wxd-stats');
    if (num(c.apparent_temperature)) stat(stats, 'Feels like', deg(c.apparent_temperature),
      Math.abs(c.apparent_temperature - c.temperature_2m) < 2 ? 'Similar to the actual temperature' : c.apparent_temperature < c.temperature_2m ? 'Wind is making it feel cooler' : 'Humidity is making it feel warmer');
    if (num(c.relative_humidity_2m)) stat(stats, 'Humidity', Math.round(c.relative_humidity_2m) + '%');
    if (num(c.wind_speed_10m)) stat(stats, 'Wind', Math.round(c.wind_speed_10m) + ' km/h', num(c.wind_direction_10m) ? 'From the ' + compass(c.wind_direction_10m) : '');
    var uv = d.uv_index_max && d.uv_index_max[i0];
    if (num(uv)) stat(stats, 'UV index', String(Math.round(uv)), uvWord(uv) + ' today');
    var mm = d.precipitation_sum && d.precipitation_sum[i0];
    var pp = d.precipitation_probability_max && d.precipitation_probability_max[i0];
    if (num(mm) || num(pp)) stat(stats, 'Rain today', num(mm) ? (Math.round(mm * 10) / 10) + ' mm' : '–', num(pp) ? Math.round(pp) + '% chance' : '');
    if (d.sunrise && d.sunset) stat(stats, 'Sunrise', clock(parseLocal(d.sunrise[i0])), 'Sunset ' + clock(parseLocal(d.sunset[i0])));
    box.appendChild(stats);

    // next 24 hours, every 2 hours
    if (hr && hr.time && hr.time.length) {
      var now = new Date();
      var key = localDay(now) + 'T' + ('0' + now.getHours()).slice(-2) + ':00';
      var h0 = hr.time.indexOf(key);
      if (h0 >= 0) {
        var row = el('div', 'wxd-hours');
        for (var h = h0; h < hr.time.length && h <= h0 + 24; h += 2) {
          var cell = el('div', 'wxd-hour');
          cell.appendChild(el('div', 'wxd-hour-time', h === h0 ? 'Now' : hourLabel(parseLocal(hr.time[h]))));
          var ic = el('div', 'wx-icon');
          ic.innerHTML = iconSvg(info(hr.weather_code[h])[2], hr.is_day && hr.is_day[h] === 0);
          cell.appendChild(ic);
          cell.appendChild(el('div', 'wxd-hour-temp', num(hr.temperature_2m[h]) ? deg(hr.temperature_2m[h]) : '–'));
          var r = hr.precipitation_probability && hr.precipitation_probability[h];
          cell.appendChild(el('div', 'wx-rain', num(r) && r >= 20 ? Math.round(r) + '%' : ''));
          row.appendChild(cell);
        }
        box.appendChild(row);
      }
    }

    // the week, with each day's range on a shared scale
    var lo = Infinity, hi = -Infinity, last7 = Math.min(d.time.length - 1, i0 + 6);
    for (var a = i0; a <= last7; a++) {
      if (num(d.temperature_2m_min[a])) lo = Math.min(lo, d.temperature_2m_min[a]);
      if (num(d.temperature_2m_max[a])) hi = Math.max(hi, d.temperature_2m_max[a]);
    }
    var week = el('div', 'wxd-week');
    for (var i = i0; i <= last7; i++) {
      var line = el('div', 'wxd-day');
      line.appendChild(el('div', 'wxd-day-name', i === i0 ? 'Today' : weekday(String(d.time[i]))));
      var di = el('div', 'wx-icon');
      di.innerHTML = iconSvg(info(d.weather_code[i])[2], false);
      line.appendChild(di);
      var dr = d.precipitation_probability_max && d.precipitation_probability_max[i];
      line.appendChild(el('div', 'wx-rain', num(dr) && dr >= 20 ? Math.round(dr) + '%' : ''));
      line.appendChild(el('div', 'wxd-day-lo', deg(d.temperature_2m_min[i])));
      var track = el('div', 'wxd-track');
      var bar = el('div', 'wxd-bar');
      var span = hi - lo || 1;
      bar.style.left = ((d.temperature_2m_min[i] - lo) / span * 100) + '%';
      bar.style.width = Math.max(4, (d.temperature_2m_max[i] - d.temperature_2m_min[i]) / span * 100) + '%';
      track.appendChild(bar);
      line.appendChild(track);
      line.appendChild(el('div', 'wxd-day-hi', deg(d.temperature_2m_max[i])));
      week.appendChild(line);
    }
    box.appendChild(week);
    box.appendChild(el('div', 'wxd-foot', 'Weather: Open-Meteo · updated ' + clock(new Date(rec.at))));
    return true;
  }

  // ---------- for other modules ----------
  function wet(code) { return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95; }

  // When the next rain starts, from the 15-minute forecast (each value is the
  // total of the preceding 15 minutes), else from the hourly one.
  function nextRain(j, nowMs) {
    var m = j.minutely_15;
    var i, end, c;
    if (m && m.time && m.precipitation && m.time.length) {
      for (i = 0; i < m.time.length; i++) {
        end = parseLocal(m.time[i]);
        if (!end || end.getTime() <= nowMs) continue;
        var mm = m.precipitation[i];
        c = m.weather_code ? m.weather_code[i] : null;
        if (num(mm) && (mm >= 0.3 || (mm >= 0.1 && (!num(c) || wet(c))))) {
          return { at: Math.max(end.getTime() - 15 * 60 * 1000, nowMs), code: num(c) && wet(c) ? c : 61 };
        }
      }
      return null;
    }
    var hr = j.hourly;
    if (!hr || !hr.time) return null;
    for (i = 0; i < hr.time.length; i++) {
      end = parseLocal(hr.time[i]);
      if (!end || end.getTime() + 3600 * 1000 <= nowMs) continue;
      if (end.getTime() > nowMs + 6 * 3600 * 1000) break;
      c = hr.weather_code[i];
      var p = hr.precipitation_probability ? hr.precipitation_probability[i] : null;
      if (wet(c) && (!num(p) || p >= 50)) return { at: Math.max(end.getTime(), nowMs), code: c };
    }
    return null;
  }

  // The conditions now, or null without a recent forecast. sunrise and sunset
  // are today's; code, kind (icon name), humidity and the rain timing need a
  // forecast from the last 3 hours.
  function now() {
    var rec = last;
    if (!rec || !valid(rec.data) || Date.now() - rec.at > HIDE_AFTER) return null;
    var j = rec.data, c = j.current, d = j.daily;
    var i0 = d.time.indexOf(localDay(new Date()));
    var out = {
      sunrise: i0 >= 0 && d.sunrise ? parseLocal(d.sunrise[i0]) : null,
      sunset: i0 >= 0 && d.sunset ? parseLocal(d.sunset[i0]) : null,
      code: null, kind: null, isDay: c.is_day !== 0, humidity: null, raining: false, rainAt: null, rainCode: null
    };
    if (Date.now() - rec.at > NOW_STALE) return out;
    var t = Date.now();
    var r = nextRain(j, t);
    out.code = num(c.weather_code) ? c.weather_code : (i0 >= 0 ? d.weather_code[i0] : null);
    out.kind = out.code == null ? null : info(out.code)[2];
    out.humidity = num(c.relative_humidity_2m) ? c.relative_humidity_2m : null;
    out.raining = wet(out.code) || !!(r && r.at <= t + 5 * 60 * 1000);
    if (r && !out.raining) { out.rainAt = new Date(r.at); out.rainCode = r.code; }
    return out;
  }

  var listeners = [];
  function notify() {
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) { /* keep the others going */ } }
  }

  GH.Weather = {
    isOn: function () { return root.classList.contains('on'); },
    renderDetail: renderDetail,
    now: now,
    onUpdate: function (fn) { listeners.push(fn); },
    icon: iconSvg,
    info: info,
    clock: clock
  };

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearInterval(timer); timer = null; return; }
    render();
    if (!last || Date.now() - last.at > 10 * 60 * 1000) load();
    startTimer();
  });

  last = readCache();
  render();
  load();
  startTimer();
}());
