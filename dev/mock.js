// Glass Home - preview mock of the TV's installed apps (served by dev/run.js
// at /dev/mock.js, never packaged). Icons are left out (name tiles);
// on the TV each app's own icon is used where config.js allows.
(function () {
  'use strict';
  // Plain name tiles only: no imitation logos are drawn here.
  var names = ['YouTube', 'Netflix', 'Prime Video', 'Samsung TV Plus', 'Disney+', 'Internet', 'Spotify'];
  window.GH_MOCK = {
    apps: names.map(function (n) { return { id: 'mock.' + n.replace(/[^A-Za-z]/g, ''), name: n, iconPath: null }; }),
    // Two HDMI devices plugged in (one showing a live signal), one port empty.
    videoSources: {
      connected: [{ type: 'HDMI', number: 1, signal: true }, { type: 'HDMI', number: 2, signal: false }],
      disconnected: [{ type: 'HDMI', number: 3, signal: null }]
    }
  };
}());
