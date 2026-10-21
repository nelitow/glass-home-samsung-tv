/*
 * Glass Home - the sky: the home screen follows the real day and weather.
 *
 * - Period of the day: dawn, day, golden hour or night, from today's sunrise
 *   and sunset (weather data; 6:00 and 18:30 without it). home.js shows the
 *   bundled photos tagged for the period (GH.Sky.period(), onPeriod(fn)).
 * - Weather over the photos: rain running down the glass, storms with
 *   lightning, fog, morning haze when it is very humid, snow, a grey cast
 *   when it is overcast, and a warm wash at dawn and golden hour.
 * - Rain alert: a banner under the weather when rain is due within 2 hours
 *   ("Rain in about 40 min"), once per shower and again when it gets close.
 *
 * Only transform and opacity animate; html.lite uses half the drops.
 * Preview: ?fx=rain|drizzle|storm|fog|haze|snow|cloud|clear,
 * ?period=dawn|day|golden|night, ?rainin=<minutes> (with ?wx=mock).
 */
(function () {
  'use strict';
  var GH = window.GH;
  var cfg = GH.config;
  var Q = GH.query || {};
  var html = document.documentElement;
  var root = document.getElementById('sky');
  var alertEl = document.getElementById('rain-alert');
  var MIN = 60 * 1000;
  var listeners = [];
  var period = null;
  var fx = null;
  var flashTimer = null;
  var alertTimer = null;
  var built = {};

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage off */ } }

  function weather() { return GH.Weather && GH.Weather.now ? GH.Weather.now() : null; }

  function todayAt(h, m) { var d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function div(cls) { var e = document.createElement('div'); e.className = cls; return e; }

  // ---------- period of the day ----------
  function computePeriod(w) {
    if (cfg.preview && /^(dawn|day|golden|night)$/.test(Q.period || '')) return Q.period;
    var t = Date.now();
    var rise = w && w.sunrise ? w.sunrise.getTime() : todayAt(6, 0);
    var set = w && w.sunset ? w.sunset.getTime() : todayAt(18, 30);
    if (t >= rise - 40 * MIN && t < rise + 75 * MIN) return 'dawn';
    if (t >= set - 80 * MIN && t < set + 25 * MIN) return 'golden';
    if (t >= rise + 75 * MIN && t < set - 80 * MIN) return 'day';
    return 'night';
  }

  // ---------- weather over the photos ----------
  function computeFx(w, p) {
    if (cfg.preview && Q.fx) return Q.fx;
    if (!w || !w.kind) return 'clear';
    var k = w.kind;
    if (k === 'storm') return 'storm';
    if (k === 'rain' || k === 'showers') return 'rain';
    if (k === 'drizzle') return 'drizzle';
    if (k === 'snow') return 'snow';
    if (k === 'fog') return 'fog';
    if (w.humidity >= 92 && (p === 'dawn' || new Date().getHours() < 10)) return 'haze';
    if (k === 'cloud') return 'cloud';
    return 'clear';
  }

  // Layers that only fade in and out are made once; drops are made per effect.
  function ensureLayers() {
    if (built.tints) return;
    ['golden', 'dawn', 'gloom'].forEach(function (t) { root.appendChild(div('sky-tint t-' + t)); });
    var haze = div('sky-haze');
    haze.appendChild(div('haze-a'));
    haze.appendChild(div('haze-b'));
    root.appendChild(haze);
    built.drops = div('sky-drops');
    root.appendChild(built.drops);
    built.flash = div('sky-flash');
    root.appendChild(built.flash);
    built.tints = true;
  }

  function makeRain(box, streaks, drops, beads, speed) {
    var lite = html.classList.contains('lite');
    var rain = div('sky-rain');
    var i, e;
    for (i = 0; i < (lite ? streaks / 2 : streaks); i++) {
      e = div('streak');
      e.style.left = rnd(-5, 105) + '%';
      e.style.height = Math.round(rnd(70, 150)) + 'px';
      e.style.opacity = rnd(0.25, 0.6).toFixed(2);
      e.style.animationDuration = (rnd(0.5, 0.85) * speed).toFixed(2) + 's';
      e.style.animationDelay = (-rnd(0, 2)).toFixed(2) + 's';
      rain.appendChild(e);
    }
    box.appendChild(rain);
    for (i = 0; i < (lite ? beads / 2 : beads); i++) {
      e = div('bead');
      var s = Math.round(rnd(3, 7));
      e.style.width = s + 'px';
      e.style.height = Math.round(s * 1.15) + 'px';
      e.style.left = rnd(0, 100) + '%';
      e.style.top = rnd(0, 100) + '%';
      e.style.animationDuration = rnd(5, 12).toFixed(1) + 's';
      e.style.animationDelay = (-rnd(0, 12)).toFixed(1) + 's';
      box.appendChild(e);
    }
    for (i = 0; i < (lite ? drops / 2 : drops); i++) {
      e = div('drop');
      var d = Math.round(rnd(8, 18));
      e.style.width = d + 'px';
      e.style.height = Math.round(d * 1.25) + 'px';
      e.style.left = rnd(1, 99) + '%';
      e.style.top = rnd(-10, 45) + '%';
      e.style.animationDuration = rnd(9, 22).toFixed(1) + 's';
      e.style.animationDelay = (-rnd(0, 22)).toFixed(1) + 's';
      box.appendChild(e);
    }
  }

  function makeSnow(box) {
    var n = html.classList.contains('lite') ? 35 : 70;
    for (var i = 0; i < n; i++) {
      var e = div('flake');
      var s = Math.round(rnd(3, 9));
      e.style.width = s + 'px';
      e.style.height = s + 'px';
      e.style.left = rnd(0, 100) + '%';
      e.style.opacity = rnd(0.5, 0.95).toFixed(2);
      e.style.animationDuration = rnd(9, 18).toFixed(1) + 's';
      e.style.animationDelay = (-rnd(0, 18)).toFixed(1) + 's';
      box.appendChild(e);
    }
  }

  function flash() {
    clearTimeout(flashTimer);
    flashTimer = null;
    if (fx !== 'storm') return;
    flashTimer = setTimeout(function () {
      if (!document.hidden && !html.classList.contains('vibe') && built.flash.animate) {
        built.flash.animate([{ opacity: 0 }, { opacity: 0.5 }, { opacity: 0.08 }, { opacity: 0.38 }, { opacity: 0 }],
          { duration: 700, easing: 'ease-out' });
      }
      flash();
    }, rnd(6000, 20000));
  }

  function setFx(next, p) {
    ensureLayers();
    var warm = next === 'clear' || next === 'haze';
    root.classList.toggle('golden', warm && p === 'golden');
    root.classList.toggle('dawn', warm && p === 'dawn');
    root.classList.toggle('gloom', next === 'cloud' || next === 'rain' || next === 'drizzle' || next === 'storm' || next === 'fog' || next === 'snow');
    root.classList.toggle('haze', next === 'haze');
    root.classList.toggle('fog', next === 'fog');
    if (next === fx) { if (fx === 'storm' && !flashTimer) flash(); return; }
    fx = next;
    var box = built.drops;
    box.textContent = '';
    if (next === 'rain') makeRain(box, 70, 22, 40, 1);
    else if (next === 'drizzle') makeRain(box, 24, 10, 55, 1.7);
    else if (next === 'storm') makeRain(box, 110, 28, 40, 0.75);
    else if (next === 'snow') makeSnow(box);
    root.classList.toggle('wet', next === 'rain' || next === 'drizzle' || next === 'storm');
    flash();
  }

  // ---------- rain alert ----------
  function minutesText(m) {
    if (m < 60) return Math.max(5, Math.round(m / 5) * 5) + ' min';
    var h = Math.floor(m / 60);
    var r = Math.round((m - h * 60) / 15) * 15;
    if (r === 60) { h += 1; r = 0; }
    return h + (h === 1 ? ' hour' : ' hours') + (r ? ' ' + r + ' min' : '');
  }

  function checkRain(w) {
    if (cfg.rainAlert === false || !alertEl || !GH.Weather || document.hidden || html.classList.contains('vibe')) return;
    var at = w && w.rainAt ? w.rainAt.getTime() : null;
    var code = w && w.rainCode;
    if (cfg.preview && /^\d+$/.test(Q.rainin || '')) { at = Date.now() + +Q.rainin * MIN; code = 61; }
    if (!at) return;
    var mins = (at - Date.now()) / MIN;
    if (mins < 5 || mins > 120) return;
    var ev = Math.round(at / (15 * MIN));
    var seen = lsGet('gh.rainAlert');
    var due = !seen || seen.ev !== ev || (mins <= 45 && seen.mins > 45);
    if (!due) return;
    lsSet('gh.rainAlert', { ev: ev, mins: mins });
    var kind = GH.Weather.info(code)[2];
    var noun = kind === 'storm' ? 'Storms' : kind === 'drizzle' ? 'Light rain' : kind === 'snow' ? 'Snow' : 'Rain';
    alertEl.querySelector('.ra-icon').innerHTML = GH.Weather.icon(kind, w ? !w.isDay : false);
    alertEl.querySelector('.ra-title').textContent = mins <= 10 ? noun + ' starting soon' : noun + ' in about ' + minutesText(mins);
    alertEl.querySelector('.ra-sub').textContent = 'From around ' + GH.Weather.clock(new Date(at)) +
      (cfg.weather && cfg.weather.place ? ' · ' + cfg.weather.place : '');
    alertEl.classList.add('on');
    if (GH.Sounds && GH.Sounds.chime) GH.Sounds.chime();
    clearTimeout(alertTimer);
    alertTimer = setTimeout(function () { alertEl.classList.remove('on'); }, 15000);
  }

  // ---------- update ----------
  function update() {
    var w = weather();
    var p = computePeriod(w);
    if (root && cfg.livingSky !== false) setFx(computeFx(w, p), p);
    if (p !== period) {
      period = p;
      html.setAttribute('data-period', p);
      listeners.forEach(function (fn) { try { fn(p); } catch (e) { /* keep the others going */ } });
    }
    checkRain(w);
  }

  GH.Sky = {
    period: function () { return period; },
    onPeriod: function (fn) { listeners.push(fn); }
  };

  var timer = null;
  function start() {
    clearInterval(timer);
    update();
    timer = setInterval(update, MIN);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearInterval(timer);
      clearTimeout(flashTimer);
      flashTimer = null;
      if (alertEl) alertEl.classList.remove('on');
      return;
    }
    start();
  });
  if (GH.Weather && GH.Weather.onUpdate) GH.Weather.onUpdate(update);
  start();
}());
