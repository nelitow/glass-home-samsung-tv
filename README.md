# Glass Home — a home screen for Samsung The Frame

A quiet, Apple TV-style home screen for **Samsung The Frame** (and other Tizen
TVs): full-screen photography that follows the real sky, a frosted-glass dock of
your apps, the weather, what's playing, and — optionally — the physical **Home
button remapped to open it instead of Smart Hub**. No ads, no tracking, no
frameworks. A small password-protected website, served by the TV itself, lets
you add photos and shortcuts from your phone.

> This is a **The Frame–focused fork** of
> [victaphu/glass-home-samsung-tv](https://github.com/victaphu/glass-home-samsung-tv),
> tested on a **2022 Samsung The Frame (`QN50LS03BA` / `QN50LS03BAGXZD`), Tizen
> 6.5**. It adds a living sky, time-of-day photos, now-playing, album-art
> colours, seasonal touches, a Vibe mode, a Samsung Home tile, and a toolkit to
> remap the Home button. Upstream was tested on a 2023 Q70C (Tizen 8); most of
> this works across recent Tizen TVs, but the Home-button remap is Frame/
> firmware-specific.

![Glass Home on the TV](docs/screenshots/home.png)

## Features

- **Photography that follows the day.** Full-screen photos crossfade every 45s
  with a slow drift; 22 bundled CC0 photos mixed with your own, shuffled daily.
  Photos are tagged **dawn / day / golden / night** and shown at the matching
  time of day.
- **A living sky over the photos.** Real weather is drawn on top: rain running
  down the glass, storms with lightning, fog, morning haze, snow, an overcast
  cast, and a warm wash at dawn and golden hour.
- **Weather, selectable.** Clock, date, and the weather (now + 7 days) from
  [Open-Meteo](https://open-meteo.com/) — no account or key. Press **Up** from
  the dock for a details panel. A **rain alert** banner warns when rain is due
  within the next two hours.
- **A frosted-glass dock** of your apps, then your website/YouTube shortcuts,
  then **Vibe**, **Samsung Home**, and **+**. Apps open with a launch-zoom
  animation.
- **Now playing.** When Spotify or another app is playing in the background, the
  dock shows the track, and the screen quietly takes on the **album art's
  colours**.
- **Vibe mode.** A dock tile that fills the screen with warm light drifting over
  a dark background — a lamp for the room.
- **Samsung Home tile.** Opens Samsung's Smart Hub when you want it (and your
  safety net if you remap the Home button).
- **Seasonal touches.** Festa junina bunting in June, Christmas lights from
  December to 6 January, fireworks at midnight on New Year.
- **An app grid.** Press **Down** from the dock for every installed store app,
  A–Z.
- **The + phone website.** Shows the TV's address and a password; open it on
  your phone (same Wi-Fi) to upload photos and add YouTube/website shortcuts.
- **A screensaver** (photos only, after 3 minutes idle) and evening dimming.
- **Interface sounds**, synthesised, on every move (optional).
- **Home button → Glass Home** (optional, advanced): see
  [Replacing the Home button](#replacing-the-home-button).

![The + panel (desktop preview; on the TV it shows the TV's own address)](docs/screenshots/add-panel.png)

Photos of it on the tested TV, and of the Samsung settings from the guide, are
in [docs/screenshots/on-tv](docs/screenshots/on-tv/).

## Read this first

- **You can replace the Home button — carefully.** Out of the box the Home
  button opens Smart Hub; no app can change that through a public API. This fork
  includes a toolkit that, on a TV in Developer Mode, points the Home button at
  Glass Home (see below). It writes undocumented platform settings and is
  reversible only with a baseline you save first — it's optional and advanced.
  The simpler route still works too: pin Glass Home first on the Home row, turn
  **Start with Smart Hub Home** off and **Autorun Last App** on.
- **You install it yourself** in the TV's Developer Mode, signed with a free
  Samsung developer certificate made for your TV. That needs a computer, about
  an hour the first time, and a free Samsung account. There is no ready-made
  download: a signed package only installs on the TV it was made for.
- **Tested on one TV:** a 2022 Samsung **The Frame** (`QN50LS03BA`) on Tizen
  6.5, from an Apple Silicon Mac. Other models and years should be close but may
  differ; the Home-button remap is firmware-specific. Reports welcome.
- **A big OS upgrade can delete it.** Samsung's Tizen OS upgrades have removed
  sideloaded apps on other TVs. You can reinstall it the same way.
- **The photo website is plain HTTP** on your home network. It only answers
  devices on your local network and needs the password, but anyone on the same
  Wi-Fi who intercepts traffic could see the password and photos in transit.

## Install

Step by step: **[docs/INSTALL.md](docs/INSTALL.md)**. In short:

1. Turn on Developer Mode on the TV.
2. Install Samsung's Tizen SDK command-line tools on your computer.
3. Make a free Samsung certificate for your TV (one browser sign-in).
4. Set your options in [`app/js/config.js`](app/js/config.js).
5. `scripts/build.sh`, then `scripts/install.sh`.
6. Pin it on the Home row, set it to open at power-on, and turn Developer
   Mode off again — or remap the Home button (below).

## Replacing the Home button

A toolkit in **[`tools/home-remap/`](tools/home-remap/)** makes the physical
Home button open Glass Home instead of Smart Hub, on a TV in Developer Mode. It
writes only the two platform values that decide what Home resolves to, reads
them back, and keeps an exact-value rollback. It is **advanced and unsupported**,
reversible only with a baseline you capture first, and was tested on a 2022 The
Frame (Tizen 6.5) — read [`tools/home-remap/README.md`](tools/home-remap/README.md)
in full before running anything. The dock's **Samsung Home** tile is the escape
hatch back to Samsung's menus if anything goes wrong.

## Settings

All in [`app/js/config.js`](app/js/config.js):

| Setting | What it does |
|---|---|
| `apps` | The dock apps, in order. Each is found by its Tizen app ID, then by name. Remove what you don't have. `icon: false` shows a plain name tile. |
| `weather` | Off until you set `enabled: true`, `latitude`, `longitude` (`place` is the label). Now + 7 days. |
| `livingSky` | Weather drawn over the photos (rain, storms, fog, snow, dawn/golden wash). |
| `timeOfDayPhotos` | Show photos tagged for the current time of day. |
| `rainAlert` | Banner when rain is due within two hours. |
| `albumColours` | Tint the screen with the playing track's album-art colours. |
| `launchAnimation` | Zoom the app icon to fill the screen when opening. |
| `seasons` | Festa junina (June), Christmas lights (Dec–6 Jan), New Year fireworks. |
| `vibe` | The warm-light Vibe tile on the dock. |
| `samsungHome` | The Samsung Home tile (an app id to open, or `false` to drop it). |
| `sounds` / `soundVolume` | Interface sounds on each move. |
| `grid` | The app grid (Down from the dock); `include` / `exclude` / `icons`. |
| `locale` | Date and time format, e.g. `'en-GB'`; empty uses the TV's. |
| `ambient` | Screensaver delay. |
| `night` | Evening dimming hours (24-hour, TV clock). |
| `youtubeMode` | How YouTube shortcuts are opened (see below). |
| `photoIntervalMs` | How often the photo changes. |

Your own logo: `scripts/use-logo.sh path/to/logo.png` (square, ideally 1024 x
1024) makes the TV icon and the website icons. The on-screen name is in
`app/index.html` (`brand-name`) and `app/config.xml` (`<name>`).

## Using it

| Remote | What happens |
|---|---|
| Left / Right | move along the dock |
| Up | open the weather details panel |
| Down | open the app grid |
| OK | open the app, website, video, Vibe, or Samsung Home |
| Hold OK | Move left, Move right, Remove (shortcuts) or Hide (apps), Cancel |
| Back | closes the menu, panel, grid or Vibe; does nothing on the home screen |
| OK on **+** | the website address and password; New password; show hidden apps |

**Photos and shortcuts.** On a phone on the same Wi-Fi, open the address shown
under **+** and sign in with the password shown there. Upload photos (up to
300, 500 MB in total; portrait photos are fitted on blurred edges or cropped),
and add websites or YouTube links (videos, playlists, Shorts, links with a
start time). New photos appear next on the TV. The phone stays signed in for
30 days.

**YouTube shortcuts** open the YouTube app at the video. On the tested TV the
plain `watch?v=` link worked from a cold start and while YouTube was running;
Samsung's documented `PAYLOAD` deep link lost the video at YouTube's "Who's
watching?" screen. The switch at the bottom of the **+** panel cycles through
watch URL, the PAYLOAD form, and both, if yours behaves differently.

**Websites** open in Samsung's own browser (the code follows Samsung's documented
method).

## How it works

```
 TV (one Tizen web app package)
 ┌──────────────────────────────┐   http://127.0.0.1:8090/local/*    ┌────────────────────────────┐
 │ Glass Home                   │ ─────────────────────────────────▶ │ Photos service             │
 │ index.html, js/, css/        │   loopback + this install's key    │ app/service/*.js (Node)    │
 │ dock, photos, clock, + panel │ ◀──── photos, shortcuts, password  │ port 8090 on the home LAN  │
 └──────────────────────────────┘                                    └─────────────▲──────────────┘
         starts the service at launch                                             │ http://<TV IP>:8090
                                                                     phone on the home Wi-Fi, signed in
```

- **The app** is what you see. It asks the service for your photos and
  shortcuts and keeps the last answer, so it still works if the service is
  down. It animates only `transform` and `opacity` (the TV's GPU is modest), and
  a start-up frame probe drops to a lighter mode on slower sets.
- **The service** is a Tizen web service inside the same package (Node.js;
  the tested TV runs Node 16, the code sticks to the Node 12 API). It serves
  the phone website and keeps everything in the app's private data folder,
  which survives restarts and updates and is deleted with the app. (Only if
  that folder isn't writable does it fall back to `/home/owner/share/GlassHome1`,
  which is kept after uninstalling; the **+** panel shows which is in use.)
- With the free (public-level) certificate the service can't start itself at
  boot; the app starts it whenever it opens.

**Security.** The password is three random words and two digits, stored as a
PBKDF2-SHA256 hash. Five wrong tries lock a device out for 5 minutes, and a
device guessing passwords can't block others from signing in. The site only
answers private-network and loopback addresses, refuses other host names (DNS
rebinding), and has CSRF protection and a strict content security policy.
Uploads are checked as real JPEGs with size caps. The app and its service share
a random key generated per install (never committed). So the TV can show the
password after a restart, the service keeps it in a private file next to its
hash.

**Network use.** The app contacts nothing except the service itself;
Open-Meteo if weather is on; each website you add, once, for its own icon (no
third-party favicon services, never addresses on your home network); and
YouTube for shortcut titles and thumbnails.

## Develop

Needs Node 22 (what it was developed and tested with) and a Chromium-based browser (Chrome, Brave, Chromium or Edge;
set `BROWSER` to choose). The servers listen only on 127.0.0.1; the demo
shortcuts and the tests fetch site icons and YouTube details from the
internet (`node dev/run.js --no-fetch` avoids that, but some tests then fail).

```
node dev/run.js --demo     # service :18090, TV app :18091, throwaway data
                           # TV app:  http://127.0.0.1:18091/index.html?preview=1
                           # website: http://127.0.0.1:18090/ (password printed)
dev/test-api.sh            # website + service API (curl)
node dev/ui-test.js        # TV app and phone website in a headless browser
node dev/test-netutil.js   # address rules (IPv4/IPv6, LAN, loopback, hosts)
node dev/test-parsers.js   # hostile-page parsing stays fast
node dev/test-limiter.js   # sign-in throttle and fair queue
node dev/test-data.js      # TV app's service client
node dev/test-ytparse.js   # YouTube link parser
node dev/test-backdrop.js  # photo rotation
node dev/lint-node12.js    # service code stays within the Node 12 API
```

Preview options: `?preview=1`, `?api=…`, `?focus=N`, `?bg=nature-05.jpg`,
`?panel=1`, `?menu=1`, `?still=1`, `?grid=1`, `?wx=mock` (sample weather),
`?wx=panel`, `?vibe=1`, `?fx=rain|drizzle|storm|fog|haze|snow|cloud|clear`,
`?period=dawn|day|golden|night`, `?season=junina|christmas|newyear`,
`?np=1` (sample track), `?idle=MS` (screensaver delay), `?night=1`.

The dev tools and image scripts use macOS's `sips`; the app itself has no
platform dependency.

## Also in here

- **[`tools/home-remap/`](tools/home-remap/):** remap the physical Home button
  to Glass Home (advanced; The Frame / Tizen 6.5).
- **[docs/SAMSUNG-SETTINGS.md](docs/SAMSUNG-SETTINGS.md):** turning off
  Samsung's content recognition, ad ID, promotions and autoplay, a DNS ad
  filter that kept every app working, and how to undo each.
- **[`tools/`](tools/):** a standard-library Python remote for the TV's local
  control API (`tvremote.py`), a page that turns an iPhone on the same Wi-Fi
  into a camera pointed at the TV (`phonecam.py`; Samsung TVs can't take
  screenshots), and Wake-on-LAN (`wake.py`).

## Credit

A The Frame–focused fork of
[victaphu/glass-home-samsung-tv](https://github.com/victaphu/glass-home-samsung-tv),
extended with [Claude Code](https://claude.com/claude-code). The Home-button
method follows the public work in
[CleanFrame](https://github.com/nthnclrk/CleanFrame),
[arn0-tv](https://github.com/NelsonEU/arn0-tv) and
[couchroot](https://github.com/splitcipher/couchroot).

## Licence

[MIT](LICENSE). Photo and data credits: [CREDITS.md](CREDITS.md). Not affiliated
with Samsung, Apple or any app shown.
