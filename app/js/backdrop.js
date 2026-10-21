/*
 * Glass Home - rotating background.
 *
 * Two stacked layers. The next photo is loaded and decoded (img.decode())
 * off-screen, placed in the hidden layer, then faded in over the visible one
 * (1.6 s). Each photo drifts very slowly (scale 1.00 -> 1.06, Ken Burns).
 * Photos that fail to load are skipped. The order is shuffled once a day;
 * newly uploaded photos jump the queue so they show up next. opts.eligible(it)
 * limits the rotation to photos that suit the moment (the time of day); when
 * none do, all are used.
 * Only transform and opacity are animated.
 */
(function () {
  'use strict';
  var GH = window.GH;

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function decodeImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.alt = '';
      var settled = false;
      function ok() { if (!settled) { settled = true; resolve(img); } }
      function bad() { if (!settled) { settled = true; reject(new Error('load failed: ' + url)); } }
      img.onerror = bad;
      img.src = url;
      if (img.decode) img.decode().then(ok, function () { if (img.complete && img.naturalWidth) ok(); else bad(); });
      else img.onload = ok;
      setTimeout(bad, 20000);
    });
  }

  function Backdrop(layerA, layerB, opts) {
    this.layers = [layerA, layerB];
    this.front = -1;                 // index of the visible layer
    this.opts = opts || {};
    this.items = [];                 // [{ key, url, credit, user, fresh }]
    this.byKey = {};
    this.order = [];
    this.day = null;
    this.fresh = [];                 // newly added keys, shown first
    this.queued = {};
    this.bad = {};                   // key -> time it failed to load (retried after 10 min)
    this.current = null;
    this.timer = null;
    this.dueAt = 0;
    this.remaining = 0;
    this.paused = false;
    this.busy = false;
    this.started = false;
    this.anims = [null, null];
    var seen = GH.ls.get('gh.bg.seen');
    this.seen = seen && seen.day === today() ? seen.keys : [];
  }

  // items: [{ key, url, credit, user, fresh }]. Fresh items (new uploads) are
  // queued to show next, newest last.
  Backdrop.prototype.setPhotos = function (items) {
    var self = this;
    this.items = items.slice();
    this.byKey = {};
    this.items.forEach(function (it) {
      self.byKey[it.key] = it;
      if (it.fresh && !self.queued[it.key] && self.seen.indexOf(it.key) < 0) {
        self.queued[it.key] = true;   // each upload jumps the queue once
        self.fresh.push(it.key);
      }
    });
    this.fresh = this.fresh.filter(function (k) { return self.byKey[k]; });
    this.day = null;                  // reshuffle lazily
    if (this.started && !this.current && !this.busy) this.advance();
  };

  Backdrop.prototype._ensureOrder = function () {
    var d = today();
    if (this.day === d && this.order.length === this.items.length) return;
    if (this.day && this.day !== d) this.seen = [];
    this.day = d;
    var keys = this.items.map(function (it) { return it.key; }).sort();
    var rnd = mulberry32(hash(d));
    for (var i = keys.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = keys[i]; keys[i] = keys[j]; keys[j] = t;
    }
    this.order = keys;
  };

  Backdrop.prototype._pick = function () {
    var self = this;
    while (this.fresh.length) {
      var k = this.fresh.shift();
      if (this.byKey[k] && !this._isBad(k)) return this.byKey[k];
    }
    this._ensureOrder();
    var cur = this.current && this.current.key;
    var ok = this.opts.eligible;
    var pool = ok ? this.order.filter(function (key) { return ok(self.byKey[key]) && !self._isBad(key); }) : [];
    if (!ok || !pool.length || (pool.length === 1 && pool[0] === cur)) pool = this.order;
    function firstUnseen() {
      for (var i = 0; i < pool.length; i++) {
        var key = pool[i];
        if (key !== cur && !self._isBad(key) && self.seen.indexOf(key) < 0) return self.byKey[key];
      }
      return null;
    }
    var it = firstUnseen();
    if (!it) {                        // everything shown today: start the cycle again
      this.seen = [];                 // (the current photo just cannot come first)
      it = firstUnseen();
    }
    return it;
  };

  // A photo that failed (the service briefly down, say) is skipped for a while,
  // not for the rest of the session: the app can stay open for days.
  Backdrop.prototype._isBad = function (key) {
    var t = this.bad[key];
    if (!t) return false;
    if (Date.now() - t > 10 * 60 * 1000) { delete this.bad[key]; return false; }
    return true;
  };

  Backdrop.prototype._markSeen = function (key) {
    if (this.seen.indexOf(key) < 0) this.seen.push(key);
    if (this.seen.length > 600) this.seen = this.seen.slice(-600);
    GH.ls.set('gh.bg.seen', { day: today(), keys: this.seen });
  };

  Backdrop.prototype.start = function (firstKey) {
    this.started = true;
    var first = firstKey && this.byKey[firstKey];
    this.advance(first || null, !!this.opts.still);
  };

  Backdrop.prototype._schedule = function (ms) {
    var self = this;
    clearTimeout(this.timer);
    this.dueAt = Date.now() + ms;
    this.timer = setTimeout(function () { self.timer = null; self.advance(); }, ms);
  };

  Backdrop.prototype.advance = function (forced, instant, attempt) {
    var self = this;
    if (this.paused || this.busy) return;
    var it = forced || this._pick();
    if (!it) { this._schedule(this.opts.interval || 45000); return; }
    attempt = attempt || 0;
    this.busy = true;
    decodeImage(it.url).then(function (img) {
      self.busy = false;
      if (self.paused) { self.pendingImg = { it: it, img: img }; return; }
      self._show(it, img, instant);
    }, function () {
      self.busy = false;
      self.bad[it.key] = Date.now();
      if (attempt < 6) self.advance(null, instant, attempt + 1);
      else self._schedule(self.opts.interval || 45000);
    });
  };

  Backdrop.prototype._kenBurns = function (layerIndex, img, key) {
    if (this.anims[layerIndex]) { try { this.anims[layerIndex].cancel(); } catch (e) { /* ignore */ } }
    this.anims[layerIndex] = null;
    if (this.opts.still || !img.animate) return;
    var rnd = mulberry32(hash(key + this.day));
    var dx = ((rnd() * 2 - 1) * 1.4).toFixed(2);
    var dy = ((rnd() * 2 - 1) * 0.9).toFixed(2);
    var scale = this.opts.scale || 1.06;
    var duration = (this.opts.interval || 45000) + (this.opts.fade || 1600) * 2 + 4000;
    this.anims[layerIndex] = img.animate([
      { transform: 'scale(1) translate3d(0, 0, 0)' },
      { transform: 'scale(' + scale + ') translate3d(' + dx + '%, ' + dy + '%, 0)' }
    ], { duration: duration, easing: 'linear', fill: 'forwards' });
    if (this.paused) this.anims[layerIndex].pause();
  };

  Backdrop.prototype._show = function (it, img, instant) {
    var self = this;
    var back = this.front < 0 ? 0 : 1 - this.front;
    var layer = this.layers[back];
    var old = this.front >= 0 ? this.layers[this.front] : null;
    layer.textContent = '';
    layer.appendChild(img);
    this._kenBurns(back, img, it.key);
    layer.style.zIndex = '2';
    if (old) old.style.zIndex = '1';
    if (instant) layer.classList.add('instant');
    // Next frame, so the transition runs from opacity 0.
    requestAnimationFrame(function () {
      layer.classList.add('show');
      setTimeout(function () {
        layer.classList.remove('instant');
        if (old && old !== layer) {
          old.classList.remove('show');
          var oi = self.layers.indexOf(old);
          if (self.anims[oi]) { try { self.anims[oi].cancel(); } catch (e) { /* ignore */ } self.anims[oi] = null; }
          old.textContent = '';
        }
      }, instant ? 50 : (self.opts.fade || 1600) + 120);
    });
    this.front = back;
    this.current = it;
    this._markSeen(it.key);
    if (this.opts.onShow) this.opts.onShow(it);
    this._schedule(this.opts.interval || 45000);
  };

  Backdrop.prototype.pause = function () {
    if (this.paused) return;
    this.paused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.remaining = Math.max(0, this.dueAt - Date.now());
    } else {
      this.remaining = 0;
    }
    this.anims.forEach(function (a) { if (a) { try { a.pause(); } catch (e) { /* ignore */ } } });
  };

  Backdrop.prototype.resume = function () {
    if (!this.paused) return;
    this.paused = false;
    this.anims.forEach(function (a) { if (a) { try { a.play(); } catch (e) { /* ignore */ } } });
    if (this.pendingImg) {
      var p = this.pendingImg;
      this.pendingImg = null;
      this._show(p.it, p.img, false);
      return;
    }
    if (!this.started) return;
    if (!this.current) { this.advance(); return; }
    this._schedule(Math.max(1500, this.remaining || 0));
  };

  GH.Backdrop = Backdrop;
}());
