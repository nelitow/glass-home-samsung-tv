/*
 * Glass Home - settings.
 *
 * Preview mode (a desktop browser, or ?preview=1 on the TV) uses a mock app
 * list and talks to the dev runner (node dev/run.js) instead of the TV service.
 *
 * Dock apps: each is resolved at start-up, first by the Tizen app IDs listed
 * (fast and exact), then by a case-insensitive name match over all installed
 * apps. Names are compared lower-case with "+" read as " plus" and other
 * punctuation removed, so "Disney+" is "disney plus". If the wrong app is
 * picked on the TV, put its exact Tizen app ID first in `ids`.
 */
(function () {
  'use strict';
  var q = {};
  String(location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
    if (!kv) return;
    var i = kv.indexOf('=');
    try {
      q[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '1' : decodeURIComponent(kv.slice(i + 1));
    } catch (e) { /* ignore malformed */ }
  });
  var preview = typeof window.tizen === 'undefined' || q.preview === '1';

  window.GH = window.GH || {};
  window.GH.query = q;
  window.GH.config = {
    preview: preview,
    // The photo/shortcut service in this package (app id <packageId>.Photos).
    serviceName: 'Photos',
    serviceBase: q.api || (preview ? 'http://127.0.0.1:18090' : 'http://127.0.0.1:8090'),

    photoIntervalMs: 45000,
    fadeMs: 1600,
    kenBurnsScale: 1.06,
    clockEveryMs: 15000,
    pollEveryMs: 20000,
    longPressMs: 700,
    // Date and time format, e.g. 'en-AU', 'en-GB', 'en-US'. Empty: the TV's own.
    locale: '',

    // How YouTube shortcuts are handed to the YouTube app. 'uri' sends
    // https://www.youtube.com/watch?v=...; 'payload' is Samsung's Smart Hub
    // deep-link form; 'both' sends both. Switchable on the TV under + (bottom
    // row). Tested on a 2023 Samsung on Tizen 8: 'payload' only worked while
    // YouTube was already running (from a fresh start YouTube showed "Who's
    // watching?" and dropped the video); 'uri' worked in both cases.
    youtubeMode: 'uri',

    // Weather under the clock (js/weather.js), from Open-Meteo (free, no key).
    // Off until you set your location. Find coordinates with
    // https://geocoding-api.open-meteo.com/v1/search?name=YOUR+TOWN
    weather: {
      enabled: true,
      place: 'Tubarão',          // label under the forecast, e.g. 'Springfield'
      latitude: -28.4667,
      longitude: -49.0069,
      timezone: 'auto',          // or an IANA name such as 'Europe/London'
      refreshMs: 15 * 60 * 1000
    },

    // The photos follow the real sky (js/sky.js): rain on the glass, fog,
    // storms, a warm wash at dawn and golden hour, and a banner when rain is
    // about to start. Bundled photos tagged dawn/day/golden/night in
    // wallpapers/manifest.json show at that time of day (your own always do).
    livingSky: true,
    timeOfDayPhotos: true,
    rainAlert: true,

    // While music plays, the screen takes on the album art's colours.
    albumColours: true,

    // Apps open with the icon zooming to fill the screen.
    launchAnimation: true,

    // Festa junina bunting in June, Christmas lights in December, fireworks at
    // midnight on New Year's Eve (js/seasons.js).
    seasons: true,

    // A "Vibe" tile on the dock: warm light drifting over a dark screen.
    vibe: true,

    // A "Samsung Home" tile on the dock that opens the TV's own Smart Hub
    // home screen (the app id Samsung's Home button normally opens). Set to a
    // different app id to point it elsewhere, or false to drop the tile.
    samsungHome: 'com.samsung.tv.csfs',

    // Interface sounds (js/sounds.js): a tick on every move, synthesised.
    sounds: true,
    soundVolume: 0.6,

    // How often to check what other apps are playing (js/nowplaying.js).
    nowPlayingEveryMs: 3000,

    // The app grid under the dock (Down from the dock): every store app that
    // isn't already in the dock, A-Z. `include` adds built-in apps by Tizen ID,
    // `exclude` hides apps, `icons` gives an app your own icon (by Tizen ID).
    grid: {
      include: ['org.tizen.netflix-app', 'org.tizen.primevideo', 'org.tizen.browser', 'com.samsung.tv.aria-video'],
      exclude: ['2022ePop01.SmartTV', '5b8c3eb16b.BeamCTVDev', 'h6D3hH79er.emanual', 'J9fZJDMi1v.SecurityCenter'],
      icons: {
        'Jz7aUrV2Q4.Twitch': 'img/apps/twitch.png',
        'GHI3a0zMSx.XboxGamePass': 'img/apps/xbox.png',
        'AQKO41xyKP.AmazonAlexa': 'img/apps/alexa.png'
      }
    },

    // Screensaver (js/ambient.js): only the photos after this long idle.
    ambient: { enabled: true, afterMs: 3 * 60 * 1000 },

    // Evening dimming of the photos, by the TV's clock (24-hour).
    night: { enabled: true, from: '20:00', to: '06:00' },

    // The dock's apps, in order. Each is found at start-up by the Tizen app IDs
    // listed (list yours with `sdb shell 0 vd_applist` in Developer Mode), then
    // by name. Remove entries you don't have; add others the same way.
    // `tint`: the colour washed over the top of the screen while it's focused.
    // Icons come from each app's App Store listing (scripts/fetch-icons.sh).
    // `icon`: a path under app/ to use your own image, or false for a plain
    // glass tile with the app's name. Some apps report a poor icon to other
    // apps (YouTube reports its Cobalt engine's pinwheel, Prime Video's may not
    // load, Samsung TV Plus is a system app), so those default to name tiles.
    apps: [
      { key: 'youtube', tint: '#ff0033', label: 'YouTube', ids: ['9Ur5IzDKqV.TizenYouTube', 'com.samsung.tv.cobalt-yt'],
        names: ['^youtube$'], icon: 'img/apps/youtube.png' },
      { key: 'netflix', tint: '#e50914', label: 'Netflix', ids: ['org.tizen.netflix-app'],
        names: ['^netflix$', '\\bnetflix\\b'], icon: 'img/apps/netflix.png' },
      { key: 'prime', tint: '#00a8e1', label: 'Prime Video', ids: ['org.tizen.primevideo', 'org.tizen.ignition'],
        names: ['^prime video$', '^amazon prime video$', '\\bprime video\\b'], icon: 'img/apps/prime.png' },
      { key: 'disney', tint: '#1a3fd6', label: 'Disney+', ids: ['MCmYXNxgcu.DisneyPlus'],
        names: ['^disney plus$', '\\bdisney plus\\b', '^disney$'], icon: 'img/apps/disney.png' },
      { key: 'hbomax', tint: '#6a2bd9', label: 'HBO Max', ids: ['cj37Ni3qXM.HBONow'],
        names: ['^hbo max$', '^max$'], icon: 'img/apps/hbomax.png' },
      { key: 'appletv', tint: '#9a9aa6', label: 'Apple TV', ids: ['com.samsung.tv.aria-video'],
        names: ['^apple tv$'], icon: 'img/apps/appletv.png' },
      { key: 'paramount', tint: '#0064ff', label: 'Paramount+', ids: ['rJyOSqC6Up.PPlusIntl'],
        names: ['^paramount plus$'], icon: 'img/apps/paramount.png' },
      { key: 'spotify', tint: '#1db954', label: 'Spotify', ids: ['rJeHak5zRg.Spotify'],
        names: ['^spotify\\b'], icon: 'img/apps/spotify.png' },
      { key: 'browser', tint: '#3d8bfd', label: 'Internet', ids: ['org.tizen.browser'],
        names: ['^internet$', '^browser$'] }
    ]
  };
}());
