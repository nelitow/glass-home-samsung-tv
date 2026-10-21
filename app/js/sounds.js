/*
 * Glass Home - interface sounds, synthesised with Web Audio (no files): a soft
 * tick when focus moves, a brighter one on OK, and a dull bump at the end of a
 * row. Off when config `sounds` is false.
 */
(function () {
  'use strict';
  var cfg = window.GH.config;
  var ctx = null;

  function audio() {
    if (!cfg.sounds) return null;
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return ctx;
  }

  // One short sine "pluck": freq in Hz, len in seconds, peak gain 0-1.
  function tone(freq, len, peak, endFreq) {
    var a = audio();
    if (!a) return;
    var t = a.currentTime;
    var osc = a.createOscillator();
    var gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + len);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak * cfg.soundVolume, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(gain);
    gain.connect(a.destination);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  window.GH.Sounds = {
    move: function () { tone(1650, 0.045, 0.22, 1400); },
    select: function () { tone(880, 0.09, 0.30, 1320); },
    bump: function () { tone(220, 0.07, 0.30, 160); },
    back: function () { tone(1100, 0.07, 0.22, 700); }
  };
}());
