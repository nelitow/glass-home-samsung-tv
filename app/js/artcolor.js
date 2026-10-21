/*
 * Glass Home - the two main colours of a picture (album art), for tinting the
 * screen while music plays. The picture is shrunk to 24 x 24 on a canvas and
 * its pixels grouped by hue, weighted by how colourful they are; the result
 * is evened out so it reads well behind white text.
 *
 * GH.artColors(url) -> Promise of [[r, g, b], [r, g, b]], or null when the
 * picture can't be read (no picture, or a server that forbids it).
 */
(function () {
  'use strict';

  function toHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }

  function toRgb(h, s, l) {
    function f(n) {
      var k = (n + h / 30) % 12;
      var a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    }
    return [f(0), f(8), f(4)];
  }

  function even(hsl) {
    return toRgb(hsl[0], Math.max(0.5, Math.min(0.85, hsl[1])), Math.max(0.42, Math.min(0.58, hsl[2])));
  }

  function pick(px) {
    var buckets = [];
    var i;
    for (i = 0; i < 12; i++) buckets.push({ w: 0, h: 0, s: 0, l: 0 });
    for (i = 0; i < px.length; i += 4) {
      var c = toHsl(px[i], px[i + 1], px[i + 2]);
      if (c[1] < 0.2 || c[2] < 0.1 || c[2] > 0.92) continue;
      var w = c[1] * (1 - Math.abs(c[2] - 0.5));
      var b = buckets[Math.floor(c[0] / 30) % 12];
      b.w += w; b.h += c[0] * w; b.s += c[1] * w; b.l += c[2] * w;
    }
    var ranked = buckets.filter(function (x) { return x.w > 0; })
      .map(function (x) { return [x.h / x.w, x.s / x.w, x.l / x.w, x.w]; })
      .sort(function (a, z) { return z[3] - a[3]; });
    if (!ranked.length || ranked[0][3] < 4) return [[120, 120, 132], [72, 72, 84]];   // black and white art
    var first = ranked[0];
    var second = null;
    for (i = 1; i < ranked.length; i++) {
      var dh = Math.abs(ranked[i][0] - first[0]);
      if (Math.min(dh, 360 - dh) >= 40 && ranked[i][3] >= first[3] * 0.15) { second = ranked[i]; break; }
    }
    if (!second) second = [(first[0] + 35) % 360, first[1], first[2] * 0.8];
    return [even(first), even(second)];
  }

  function artColors(url) {
    return new Promise(function (resolve) {
      if (!url) { resolve(null); return; }
      var done = false;
      function finish(v) { if (!done) { done = true; resolve(v); } }
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = 24;
          c.height = 24;
          var x = c.getContext('2d');
          x.drawImage(img, 0, 0, 24, 24);
          finish(pick(x.getImageData(0, 0, 24, 24).data));
        } catch (e) {
          finish(null);                               // the server didn't allow reading the pixels
        }
      };
      img.onerror = function () { finish(null); };
      setTimeout(function () { finish(null); }, 6000);
      img.src = url;
    });
  }

  window.GH.artColors = artColors;
}());
