/*
 * Glass Home - seasonal touches, by the TV's date:
 * - June: festa junina bunting (bandeirinhas) swaying across the top.
 * - 1 December to 6 January: Christmas lights twinkling along the top.
 * - New Year: fireworks and the new year's number for the first 15 minutes
 *   of 1 January.
 * Checked every minute, so they come and go on their own. Off when config
 * `seasons` is false. Preview: ?season=junina|christmas|newyear.
 */
(function () {
  'use strict';
  var GH = window.GH;
  var cfg = GH.config;
  var Q = GH.query || {};
  var html = document.documentElement;
  var root = document.getElementById('season');
  if (!root || cfg.seasons === false) return;
  var SVG = 'http://www.w3.org/2000/svg';
  var current = null;
  var fwTimer = null;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function div(cls) { var e = document.createElement('div'); e.className = cls; return e; }

  function which() {
    if (cfg.preview && /^(junina|christmas|newyear)$/.test(Q.season || '')) return Q.season;
    var d = new Date();
    var m = d.getMonth(), day = d.getDate();
    if (m === 0 && day === 1 && d.getHours() === 0 && d.getMinutes() < 15) return 'newyear';
    if (m === 5) return 'junina';
    if (m === 11 || (m === 0 && day <= 6)) return 'christmas';
    return null;
  }

  // A string hanging in `swags` loops across the screen: [x, y, angle] at t (0-1 along the width).
  function stringAt(t, swags, sag, top) {
    var seg = 1 / swags;
    var u = (t % seg) / seg;
    var x = -20 + t * 1960;
    var y = top + 4 * sag * u * (1 - u);
    var slope = 4 * sag * (1 - 2 * u) / (1960 / swags);
    return [x, y, Math.atan(slope) * 180 / Math.PI];
  }

  function wire(swags, sag, top, color) {
    var svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'season-wire');
    svg.setAttribute('width', '1920');
    svg.setAttribute('height', String(top + sag + 20));
    var d = '';
    var w = 1960 / swags;
    for (var i = 0; i < swags; i++) {
      var x0 = -20 + i * w;
      d += (i ? ' ' : 'M ' + x0 + ' ' + top) + ' Q ' + (x0 + w / 2) + ' ' + (top + 2 * sag) + ' ' + (x0 + w) + ' ' + top;
    }
    var path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);
    return svg;
  }

  function junina() {
    var colors = ['#e53935', '#fdd835', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#ffffff', '#ec407a'];
    var swags = 3, sag = 22, top = -4, n = 42;
    root.appendChild(wire(swags, sag, top, 'rgba(255, 255, 255, 0.55)'));
    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) / n;
      var p = stringAt(t, swags, sag, top);
      var f = div('flag');
      f.style.left = (p[0] - 15) + 'px';
      f.style.top = p[1] + 'px';
      f.style.transform = 'rotate(' + p[2].toFixed(1) + 'deg)';
      var cloth = div('cloth');
      cloth.style.background = colors[i % colors.length];
      cloth.style.animationDuration = rnd(2.6, 4.2).toFixed(2) + 's';
      cloth.style.animationDelay = (-rnd(0, 4)).toFixed(2) + 's';
      f.appendChild(cloth);
      root.appendChild(f);
    }
  }

  function christmas() {
    var colors = ['#ff453a', '#ffd60a', '#30d158', '#0a84ff', '#ff9f0a', '#bf5af2'];
    var swags = 4, sag = 18, top = -2, n = 44;
    root.appendChild(wire(swags, sag, top, 'rgba(20, 60, 30, 0.9)'));
    for (var i = 0; i < n; i++) {
      var p = stringAt((i + 0.5) / n, swags, sag, top);
      var b = div('bulb');
      b.style.left = (p[0] - 6) + 'px';
      b.style.top = (p[1] + 2) + 'px';
      b.style.setProperty('--c', colors[i % colors.length]);
      b.style.transform = 'rotate(' + p[2].toFixed(1) + 'deg)';
      var g = div('bulb-glow');
      g.style.animationDuration = rnd(1.4, 3.6).toFixed(2) + 's';
      g.style.animationDelay = (-rnd(0, 3.6)).toFixed(2) + 's';
      b.appendChild(g);
      root.appendChild(b);
    }
  }

  // ---------- fireworks ----------
  var FW = ['#ffd60a', '#ff453a', '#64d2ff', '#30d158', '#ff9ff3', '#ffffff', '#ff9f0a', '#bf5af2'];

  function burst() {
    if (!document.hidden && !html.classList.contains('paused') && !html.classList.contains('vibe')) {
      var x = rnd(260, 1660), y = rnd(140, 560);
      var color = FW[Math.floor(rnd(0, FW.length))];
      var box = div('burst');
      box.style.left = x + 'px';
      box.style.top = y + 'px';
      var trail = div('fw-trail');
      trail.style.background = color;
      box.appendChild(trail);
      trail.animate([{ transform: 'translate3d(0, ' + (1080 - y) + 'px, 0)', opacity: 0.9 }, { transform: 'translate3d(0, 0, 0)', opacity: 0.2 }],
        { duration: 650, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', fill: 'forwards' });
      var n = html.classList.contains('lite') ? 16 : 30;
      var r = rnd(120, 230);
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2 + rnd(-0.08, 0.08);
        var d = r * rnd(0.75, 1.05);
        var s = div('spark');
        s.style.background = Math.random() < 0.25 ? '#fff' : color;
        box.appendChild(s);
        var dx = Math.cos(a) * d, dy = Math.sin(a) * d;
        s.animate([
          { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 0 },
          { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1, offset: 0.01 },
          { transform: 'translate3d(' + (dx * 0.8).toFixed(1) + 'px, ' + (dy * 0.8 + 10).toFixed(1) + 'px, 0) scale(0.9)', opacity: 1, offset: 0.35 },
          { transform: 'translate3d(' + dx.toFixed(1) + 'px, ' + (dy + 70).toFixed(1) + 'px, 0) scale(0.35)', opacity: 0 }
        ], { duration: rnd(1500, 2000), delay: 650, easing: 'ease-out', fill: 'both' });
      }
      root.appendChild(box);
      setTimeout(function () { box.remove(); }, 2700);
    }
    fwTimer = setTimeout(burst, rnd(500, 1100));
  }

  function newyear() {
    var d = new Date();
    var year = d.getMonth() === 0 ? d.getFullYear() : d.getFullYear() + 1;
    var big = div('ny-year');
    big.textContent = String(year);
    root.appendChild(big);
    if (document.body.animate) burst();
  }

  function apply() {
    var s = which();
    if (s === current) return;
    current = s;
    clearTimeout(fwTimer);
    root.textContent = '';
    root.className = s ? 'season-' + s : '';
    if (s === 'junina') junina();
    else if (s === 'christmas') christmas();
    else if (s === 'newyear') newyear();
  }

  apply();
  setInterval(apply, 60 * 1000);
}());
