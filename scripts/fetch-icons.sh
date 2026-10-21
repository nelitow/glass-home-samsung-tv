#!/bin/sh
# Downloads each dock app's official icon from its App Store listing into
# app/img/apps/<key>.png (512 x 512). Pairs are <key>:<App Store id>; the key
# matches `key` in app/js/config.js (or a `grid.icons` entry there), which
# points the icon at the file.
set -eu
cd "$(dirname "$0")/.."
mkdir -p app/img/apps
for pair in youtube:544007664 netflix:363590051 prime:545519333 disney:1446075923 \
            hbomax:1666653815 appletv:1174078549 paramount:1340650234 spotify:324684580 \
            twitch:460177396 xbox:736179781 alexa:944011620; do
  key=${pair%%:*}
  id=${pair#*:}
  art=$(curl -fsS "https://itunes.apple.com/lookup?id=$id&country=br" |
        node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).results[0];process.stdout.write(r?r.artworkUrl512:"")})')
  [ -n "$art" ] || { echo "no listing for $key ($id)" >&2; continue; }
  curl -fsS -o "app/img/apps/$key.png" "$(echo "$art" | sed 's/512x512bb\.jpg$/512x512bb.png/')"
  echo "$key"
done
