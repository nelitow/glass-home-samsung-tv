/*
 * Glass Home - what's playing in other apps, from Tizen's media controller
 * (apps such as Spotify publish their track there). Read-only; needs the
 * mediacontroller.client privilege. In preview, ?np=1 shows a sample track.
 */
(function () {
  'use strict';
  var GH = window.GH;
  var cfg = GH.config;
  var tz = !cfg.preview && typeof window.tizen !== 'undefined' ? window.tizen : null;
  var client = null;

  function read() {
    if (!tz) {
      if (GH.query.np !== '1') return null;
      return { appId: 'rJeHak5zRg.Spotify', state: 'PLAY', title: 'Don’t Stop Believin’', artist: 'Journey',
        album: 'The Essential Journey', picture: GH.query.npart || null, position: 30171, duration: 248907 };
    }
    try {
      if (!client) client = tz.mediacontroller.getClient();
      var s = client.getLatestServerInfo();
      if (!s || !s.playbackInfo) return null;
      var p = s.playbackInfo;
      if (p.state !== 'PLAY' && p.state !== 'PAUSE') return null;
      var m = p.metadata || {};
      if (!m.title) return null;
      return { appId: s.name, state: p.state, title: m.title, artist: m.artist || '', album: m.album || '',
        picture: m.picture || null, position: p.position || 0, duration: +m.duration || 0 };
    } catch (e) {
      return null;                                  // no privilege, or nothing has ever played
    }
  }

  function same(a, b) {
    if (!a || !b) return a === b;
    return a.appId === b.appId && a.state === b.state && a.title === b.title && a.artist === b.artist && a.picture === b.picture;
  }

  // Calls onChange(info or null) whenever the track or its state changes.
  function NowPlaying(onChange) {
    this.onChange = onChange;
    this.info = null;
    this.timer = null;
  }
  NowPlaying.prototype.poll = function () {
    var info = read();
    if (!same(info, this.info)) { this.info = info; this.onChange(info); }
  };
  NowPlaying.prototype.start = function () {
    var self = this;
    this.stop();
    this.poll();
    this.timer = setInterval(function () { self.poll(); }, cfg.nowPlayingEveryMs);
  };
  NowPlaying.prototype.stop = function () { clearInterval(this.timer); this.timer = null; };

  GH.NowPlaying = NowPlaying;
}());
