#!/bin/bash
# Glass Home - API tests with curl against the dev runner (127.0.0.1 / ::1 only).
#   dev/test-api.sh
# Starts its own runner on ports 18390/18391 with a throwaway data directory,
# runs every check, prints PASS/FAIL, stops the runner and deletes the data.
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
P=18390
B=http://127.0.0.1:$P
B6="http://[::1]:$P"
T="$here/tmp/api-$$"
mkdir -p "$T/data"
pass=0
fail=0
runner=

cleanup() {
  [ -n "$runner" ] && kill "$runner" 2>/dev/null && wait "$runner" 2>/dev/null
  rm -rf "$T"
}
trap cleanup EXIT

ok()   { pass=$((pass + 1)); echo "  PASS  $1"; }
bad()  { fail=$((fail + 1)); echo "  FAIL  $1   [$2]  body: $(head -c 160 "$T/body" 2>/dev/null)"; }
expect() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "got $3, want $2"; fi; }
contains() { if printf '%s' "$3" | grep -q -- "$2"; then ok "$1"; else bad "$1" "missing '$2' in: $(printf '%s' "$3" | head -c 300)"; fi; }
lacks() { if printf '%s' "$3" | grep -q -- "$2"; then bad "$1" "unexpected '$2'"; else ok "$1"; fi; }

# curl wrappers: print the status code; the body goes to $T/body
api() { # method path [cookiejar] [json]
  local m=$1 p=$2 jar=${3:-} data=${4:-}
  local args=(-s -o "$T/body" -w '%{http_code}' -X "$m" -H 'X-GH: 1')
  [ -n "$jar" ] && args+=(-b "$jar" -c "$jar")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' --data "$data")
  curl "${args[@]}" "$B$p"
}
body() { cat "$T/body"; }
# JSON bodies built with printf (bash 3.2 mangles \" inside "$(...)")
pwj() { printf '{"password":"%s"}' "$1"; }
chj() { printf '{"current":"%s","next":"%s"}' "$1" "$2"; }
idsj() { printf '{"ids":["%s","%s","%s"]}' "$1" "$2" "$3"; }
json() { python3 -c "import json,sys; d=json.load(open('$T/body')); print($1)" 2>/dev/null; }

start_runner() { # [extra run.js options]
  node "$here/run.js" --quiet --port $P --ui-port $((P + 1)) --data "$T/data" "$@" > "$T/runner.log" 2>&1 &
  runner=$!
  for _ in $(seq 1 80); do curl -s "$B/health" >/dev/null 2>&1 && return 0; sleep 0.25; done
  echo "runner did not start"; cat "$T/runner.log"; exit 2
}
stop_runner() { kill "$runner" 2>/dev/null; wait "$runner" 2>/dev/null; runner=; }

[ -f "$root/app/js/local-key.js" ] || sh "$here/new-local-key.sh" >/dev/null
KEY=$(sed -n "s/.*GH_LOCAL_KEY = '\([^']*\)'.*/\1/p" "$root/app/js/local-key.js")
local_state() { curl -s "$B/local/state?k=$KEY"; }
current_pw() { local_state | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['password']['plain'] or '')"; }

# test images, made with sips
sips -s format jpeg -s formatOptions 85 -z 1080 1920 "$root/app/wallpapers/nature-11.jpg" --out "$T/photo.jpg" >/dev/null
sips -s format jpeg -s formatOptions 80 -z 270 480 "$T/photo.jpg" --out "$T/thumb.jpg" >/dev/null
sips -s format jpeg -s formatOptions 90 -z 540 960 "$T/photo.jpg" --out "$T/thumb-big.jpg" >/dev/null
sips -s format png -z 270 480 "$T/photo.jpg" --out "$T/photo.png" >/dev/null
printf 'hello, not an image' > "$T/note.txt"
printf '\xff\xd8\xff\xe0 not really a jpeg, just the magic bytes followed by junk................' > "$T/fake.jpg"
python3 -c "import sys; sys.stdout.buffer.write(b'\xff\xd8\xff\xe0' + b'\0' * (16 * 1024 * 1024))" > "$T/big.jpg"

start_runner
echo "service"
expect "health answers" 200 "$(curl -s -o /dev/null -w '%{http_code}' $B/health)"
PW=$(current_pw)
if printf '%s' "$PW" | grep -Eq '^[a-z]+-[a-z]+-[a-z]+-[0-9]{2}$'; then ok "first start generated a three-word password ($PW)"; else bad "generated password" "$PW"; fi
contains "state file stores a PBKDF2 hash" '"alg":"pbkdf2-sha256","iter":300000' "$(cat "$T/data/state.json")"
lacks "state file holds no plain password" "$PW" "$(cat "$T/data/state.json")"

echo "website page"
H=$(curl -s -D - -o /dev/null $B/)
contains "page has a nonce CSP" "Content-Security-Policy: default-src 'none'" "$H"
contains "page cannot be framed" "X-Frame-Options: DENY" "$H"
contains "nosniff everywhere" "X-Content-Type-Options: nosniff" "$H"
lacks "page makes no external requests" 'https://' "$(curl -s $B/ | grep -o 'src="https[^"]*"\|href="https[^"]*"\|url(https[^)]*)' )"
expect "Host header from another domain refused (DNS rebinding)" 421 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example.com:18390' $B/health)"

echo "sign in"
expect "wrong password rejected" 401 "$(api POST /api/login '' '{"password":"wrong-password-11"}')"
contains "wrong password says how many tries are left" '"remaining":4' "$(body)"
expect "sign-in without the X-GH header refused (CSRF)" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' --data "$(pwj "$PW")" $B/api/login)"
expect "sign-in from a foreign Origin refused (CSRF)" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H 'X-GH: 1' -H 'Origin: http://evil.example' -H 'Content-Type: application/json' --data "$(pwj "$PW")" $B/api/login)"
expect "sign-in as text/plain refused" 415 "$(curl -s -o /dev/null -w '%{http_code}' -H 'X-GH: 1' -H 'Content-Type: text/plain' --data "$(pwj "$PW")" $B/api/login)"
J1="$T/jar1"
code=$(curl -s -D "$T/h" -o "$T/body" -w '%{http_code}' -c "$J1" -H 'X-GH: 1' -H 'Content-Type: application/json' --data "{\"password\":\"$PW\"}" $B/api/login)
expect "correct password signs in" 200 "$code"
SC=$(grep -i '^set-cookie' "$T/h")
contains "cookie is HttpOnly" "HttpOnly" "$SC"
contains "cookie is SameSite=Strict" "SameSite=Strict" "$SC"
contains "cookie is Path=/" "Path=/" "$SC"
contains "cookie lasts 30 days" "Max-Age=2592000" "$SC"
lacks "state file holds no session token" "$(grep gh_sid "$J1" | awk '{print $7}')" "$(cat "$T/data/state.json")"
expect "signed-in API works" 200 "$(api GET /api/me "$J1")"
expect "API without a session refused" 401 "$(api GET /api/me)"
api GET /api/me "$J1" >/dev/null
expect "caps reported: 300 photos, 500 MB" "300 524288000" "$(json "str(d['limits']['maxPhotos'])+' '+str(d['limits']['maxBytes'])")"
echo "photos"
code=$(curl -s -o "$T/body" -w '%{http_code}' -b "$J1" -H 'X-GH: 1' -H 'Content-Type: image/jpeg' --data-binary @"$T/photo.jpg" $B/api/photos)
expect "JPEG upload accepted" 201 "$code"
ID=$(json "d['photo']['id']")
expect "server read the JPEG size" "1920x1080" "$(json "str(d['photo']['w'])+'x'+str(d['photo']['h'])")"
if printf '%s' "$ID" | grep -Eq '^[a-f0-9]{24}$'; then ok "server chose a random file name ($ID)"; else bad "random id" "$ID"; fi
[ -f "$T/data/photos/$ID.jpg" ] && ok "photo stored as photos/$ID.jpg" || bad "photo file" "missing"
expect "new upload defaults all flags on" "True True True" "$(json "str(d['photo']['on'])+' '+str(d['photo']['home'])+' '+str(d['photo']['saver'])")"
expect "photo flags require session" 401 "$(api PATCH /api/photos/$ID '' '{"on":false}')"
expect "photo flags require CSRF header" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -b "$J1" -H 'Content-Type: application/json' --data '{"on":false}' $B/api/photos/$ID)"
expect "photo flags reject foreign Origin" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -b "$J1" -H 'X-GH: 1' -H 'Origin: http://evil.example' -H 'Content-Type: application/json' --data '{"on":false}' $B/api/photos/$ID)"
expect "photo flags saved" 200 "$(api PATCH /api/photos/$ID "$J1" '{"on":false,"home":true,"saver":false}')"
expect "TV projection keeps flags" "False True False" "$(local_state | python3 -c "import json,sys; p=json.load(sys.stdin)['photos'][0]; print(p['on'],p['home'],p['saver'])")"
expect "phone projection keeps flags" "False True False" "$(api GET /api/photos "$J1" >/dev/null; json "str(d['photos'][0]['on'])+' '+str(d['photos'][0]['home'])+' '+str(d['photos'][0]['saver'])")"
BUNDLED=$(json "d['bundled'][0]['file']")
expect "bundled defaults all flags on" "True True True" "$(json "str(d['bundled'][0]['on'])+' '+str(d['bundled'][0]['home'])+' '+str(d['bundled'][0]['saver'])")"
REV=$(local_state | python3 -c "import json,sys; print(json.load(sys.stdin)['rev'])")
expect "bundled flags saved" 200 "$(api PATCH /api/bundled/$BUNDLED "$J1" '{"on":false,"home":false,"saver":false}')"
expect "bundled edit bumps revision" "$((REV + 1))" "$(local_state | python3 -c "import json,sys; print(json.load(sys.stdin)['rev'])")"
expect "TV bundled projection keeps flags" "False False False" "$(local_state | python3 -c "import json,sys; p=json.load(sys.stdin)['bundled']['$BUNDLED']; print(p['on'],p['home'],p['saver'])")"
expect "bundled thumbnail authenticated" 401 "$(curl -s -o /dev/null -w '%{http_code}' $B/media/bundled/$BUNDLED)"
expect "bundled thumbnail served" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J1" $B/media/bundled/$BUNDLED)"
for badkey in __proto__ constructor prototype unknown.jpg; do
  expect "bundled key $badkey rejected" 404 "$(api PATCH /api/bundled/$badkey "$J1" '{"on":false}')"
  expect "bundled file $badkey not served" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J1" $B/media/bundled/$badkey)"
done
for flags in '{}' '{"on":0}' '{"home":"false"}' '{"saver":null}' '{"on":false,"extra":true}' '{"__proto__":{"on":false}}'; do
  expect "invalid flags rejected: $flags" 400 "$(api PATCH /api/bundled/$BUNDLED "$J1" "$flags")"
done
expect "flags body bounded" 413 "$(api PATCH /api/bundled/$BUNDLED "$J1" "$(python3 -c "import json; print(json.dumps({'on':'x'*300}))")")"
expect "photo flags can be restored" 200 "$(api PATCH /api/photos/$ID "$J1" '{"on":true}')"
expect "thumbnail upload accepted" 204 "$(curl -s -o /dev/null -w '%{http_code}' -X PUT -b "$J1" -H 'X-GH: 1' -H 'Content-Type: image/jpeg' --data-binary @"$T/thumb.jpg" $B/api/photos/$ID/thumb)"
expect "photo list" 200 "$(api GET /api/photos "$J1")"
expect "list contains the photo with its thumbnail" "True" "$(json "any(p['id']=='$ID' and p['thumb'] for p in d['photos'])")"
expect "photo served to the signed-in phone" "200 image/jpeg" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' -b "$J1" $B/media/photos/$ID.jpg)"
expect "photo refused without a session" 401 "$(curl -s -o /dev/null -w '%{http_code}' $B/media/photos/$ID.jpg)"
expect "photo served to the TV app (loopback + key)" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$B/media/photos/$ID.jpg?k=$KEY")"
expect "photo refused with a wrong key" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$B/media/photos/$ID.jpg?k=wrong-key-wrong-key-wrong")"
expect "PNG refused (JPEG only, magic bytes)" 415 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J1" -H 'X-GH: 1' -H 'Content-Type: image/jpeg' --data-binary @"$T/photo.png" $B/api/photos)"
expect "text refused" 415 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J1" -H 'X-GH: 1' -H 'Content-Type: image/jpeg' --data-binary @"$T/note.txt" $B/api/photos)"
expect "magic bytes without a JPEG structure refused" 415 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J1" -H 'X-GH: 1' -H 'Content-Type: image/jpeg' --data-binary @"$T/fake.jpg" $B/api/photos)"
expect "wrong content type refused" 415 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J1" -H 'X-GH: 1' -H 'Content-Type: text/plain' --data-binary @"$T/photo.jpg" $B/api/photos)"
expect "16 MB upload refused up front (15 MB cap)" 413 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J1" -H 'X-GH: 1' -H 'Content-Type: image/jpeg' --data-binary @"$T/big.jpg" $B/api/photos)"
expect "16 MB chunked upload cut off while streaming" 413 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J1" -H 'X-GH: 1' -H 'Content-Type: image/jpeg' -H 'Transfer-Encoding: chunked' --data-binary @"$T/big.jpg" $B/api/photos)"
expect "upload without a session refused" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'X-GH: 1' -H 'Content-Type: image/jpeg' --data-binary @"$T/photo.jpg" $B/api/photos)"
expect "upload without the X-GH header refused (CSRF)" 403 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J1" -H 'Content-Type: image/jpeg' --data-binary @"$T/photo.jpg" $B/api/photos)"
sleep 0.3
n=$(ls "$T/data/photos" | wc -l | tr -d ' ')
expect "refused uploads left no files behind" 1 "$n"

echo "path traversal"
for p in "/media/photos/../state.json" "/media/photos/..%2Fstate.json" "/media/photos/%2e%2e%2fstate.json" "/media/icons/..%5C..%5Cstate.json" "/%2e%2e/%2e%2e/etc/passwd" "/media/photos/$ID.jpg%00.png"; do
  code=$(curl -s --path-as-is -o /dev/null -w '%{http_code}' -b "$J1" "$B$p?k=$KEY")
  case "$code" in 400|404) ok "refused $p ($code)";; *) bad "traversal $p" "$code";; esac
done
expect "state.json is not served as a photo" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J1" "$B/media/photos/state.json")"
expect "delete with a traversal id refused" 400 "$(curl -s --path-as-is -o /dev/null -w '%{http_code}' -X DELETE -b "$J1" -H 'X-GH: 1' "$B/api/photos/..%2F..%2Fstate.json")"
expect "thumb upload with a traversal id refused" 400 "$(curl -s --path-as-is -o /dev/null -w '%{http_code}' -X PUT -b "$J1" -H 'X-GH: 1' -H 'Content-Type: image/jpeg' --data-binary @"$T/thumb.jpg" "$B/api/photos/../thumb")"
code=$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$((P + 1))/../../../../etc/passwd")
case "$code" in 403|404) ok "dev UI server refuses ../ ($code)";; *) bad "dev UI traversal" "$code";; esac
code=$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$((P + 1))/..%2f..%2f..%2fetc%2fpasswd")
case "$code" in 400|403|404) ok "dev UI server refuses %2f ($code)";; *) bad "dev UI encoded traversal" "$code";; esac
[ -f "$T/data/state.json" ] && ok "state.json untouched" || bad "state.json" "missing"
for p in /js/local-key.js /config.xml /service/server.js /service/config.json /index.html/../js/local-key.js /state.json /wallpapers/manifest.json; do
  code=$(curl -s --path-as-is -o /dev/null -w '%{http_code}' -b "$J1" "$B$p")
  case "$code" in 200) bad "app file $p served" "$code";; *) ok "app file not served: $p ($code)";; esac
done

echo "delete photo"
expect "photo deleted" 200 "$(api DELETE /api/photos/$ID "$J1")"
expect "deleted photo gone from the list" "False" "$(api GET /api/photos "$J1" >/dev/null; json "any(p['id']=='$ID' for p in d['photos'])")"
expect "deleted photo no longer served" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J1" $B/media/photos/$ID.jpg)"
[ ! -f "$T/data/photos/$ID.jpg" ] && [ ! -f "$T/data/thumbs/$ID.jpg" ] && ok "photo and thumbnail files removed" || bad "files removed" "still there"

echo "shortcuts"
expect "website shortcut added" 201 "$(api POST /api/shortcuts "$J1" '{"type":"web","url":"en.wikipedia.org/wiki/Television","name":"Wikipedia"}')"
WEB=$(json "d['shortcut']['id']")
expect "address normalised to https" "https://en.wikipedia.org/wiki/Television" "$(json "d['shortcut']['url']")"
expect "YouTube shortcut added" 201 "$(api POST /api/shortcuts "$J1" '{"type":"youtube","url":"https://youtu.be/dQw4w9WgXcQ?t=42"}')"
YTS=$(json "d['shortcut']['id']")
expect "YouTube link parsed (video id, start)" "dQw4w9WgXcQ 42" "$(json "d['shortcut']['videoId']+' '+str(d['shortcut']['start'])")"
expect "YouTube link given as a website becomes a video tile" "youtube" "$(api POST /api/shortcuts "$J1" '{"type":"web","url":"https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI"}' >/dev/null; json "d['shortcut']['type']")"
PLS=$(json "d['shortcut']['id']")
expect "javascript: address refused" 400 "$(api POST /api/shortcuts "$J1" '{"type":"web","url":"javascript:alert(1)"}')"
expect "address with a password in it refused" 400 "$(api POST /api/shortcuts "$J1" '{"type":"web","url":"https://user:pw@example.com/"}')"
expect "non-YouTube link refused as a video" 400 "$(api POST /api/shortcuts "$J1" '{"type":"youtube","url":"https://vimeo.com/123"}')"
expect "shortcut list" "Wikipedia|youtube|youtube" "$(api GET /api/shortcuts "$J1" >/dev/null; json "'|'.join([d['shortcuts'][0]['name'], d['shortcuts'][1]['type'], d['shortcuts'][2]['type']])")"
expect "reorder" 200 "$(api POST /api/shortcuts/order "$J1" "$(idsj "$PLS" "$YTS" "$WEB")")"
expect "new order kept" "$PLS $YTS $WEB" "$(json "' '.join(s['id'] for s in d['shortcuts'])")"
expect "rename" 200 "$(api PATCH /api/shortcuts/$WEB "$J1" '{"name":"News"}')"
expect "TV can delete a shortcut over the local channel" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$B/local/shortcuts/$PLS?k=$KEY")"
expect "website can delete a shortcut" 200 "$(api DELETE /api/shortcuts/$YTS "$J1")"
expect "one shortcut left" 1 "$(api GET /api/shortcuts "$J1" >/dev/null; json "len(d['shortcuts'])")"
# icon discovery runs in the background and needs the internet
for _ in $(seq 1 40); do st=$(api GET /api/shortcuts "$J1" >/dev/null; json "d['shortcuts'][0]['iconState']"); [ "$st" != "pending" ] && break; sleep 0.5; done
if [ "$st" = "ok" ]; then ok "site icon fetched from the site itself ($(json "d['shortcuts'][0]['icon']"), $(json "d['shortcuts'][0]['iconW']") px)"; else echo "  INFO  site icon not fetched (offline?): $st"; fi

echo "local channel (TV app only)"
expect "local state refused without the key" 403 "$(curl -s -o /dev/null -w '%{http_code}' $B/local/state)"
expect "local state refused with a wrong key" 403 "$(curl -s -o /dev/null -w '%{http_code}' "$B/local/state?k=nope-nope-nope-nope-nope")"
expect "local state refused with the website cookie alone" 403 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J1" $B/local/state)"
expect "local state with the key shows the password" "$PW" "$(current_pw)"
H=$(curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: http://evil.example' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: x-gh' $B/api/shortcuts)
lacks "website API grants no CORS" "Access-Control-Allow-Origin" "$H"

echo "change password"
expect "wrong current password refused" 401 "$(api POST /api/password "$J1" '{"current":"nope-nope","next":"a new password"}')"
expect "too-short new password refused" 400 "$(api POST /api/password "$J1" "$(chj "$PW" 123)")"
cp "$J1" "$T/jar-old"
NEWPW="blue harbour lights"
expect "password changed" 200 "$(api POST /api/password "$J1" "$(chj "$PW" "$NEWPW")")"
expect "old session rejected" 401 "$(api GET /api/me "$T/jar-old")"
expect "changer gets a fresh session" 200 "$(api GET /api/me "$J1")"
expect "old password no longer signs in" 401 "$(api POST /api/login '' "$(pwj "$PW")")"
expect "TV shows the new password" "$NEWPW" "$(current_pw)"
J2="$T/jar2"
expect "new password signs in" 200 "$(api POST /api/login "$J2" "$(pwj "$NEWPW")")"
expect "TV makes a new password" 200 "$(curl -s -o "$T/body" -w '%{http_code}' -X POST "$B/local/password?k=$KEY")"
TVPW=$(json "d['plain']")
expect "after the TV's new password, phone sessions end" "401 401" "$(api GET /api/me "$J1") $(api GET /api/me "$J2")"
J3="$T/jar3"
expect "TV's new password signs in (any case and spacing)" 200 "$(api POST /api/login "$J3" "$(pwj "$(printf '%s' "$TVPW" | tr 'a-z-' 'A-Z ')")")"

echo "restart (power cut)"
stop_runner
start_runner
expect "session survives a service restart" 200 "$(api GET /api/me "$J3")"
expect "TV still shows the password after a restart" "$TVPW" "$(current_pw)"
expect "shown.json is private (0600)" "600" "$(stat -f %Lp "$T/data/shown.json" 2>/dev/null || stat -c %a "$T/data/shown.json")"
expect "bundled preferences survive restart" "False False False" "$(api GET /api/photos "$J3" >/dev/null; json "str(d['bundled'][0]['on'])+' '+str(d['bundled'][0]['home'])+' '+str(d['bundled'][0]['saver'])")"
expect "one shortcut still there" 1 "$(api GET /api/shortcuts "$J3" >/dev/null; json "len(d['shortcuts'])")"

echo "lockout (from ::1, a different address than 127.0.0.1)"
for i in 1 2 3 4; do
  c=$(curl -s -g -o "$T/body" -w '%{http_code}' -H 'X-GH: 1' -H 'Content-Type: application/json' --data '{"password":"guess-'$i'"}' "$B6/api/login")
  expect "wrong try $i from ::1 rejected" 401 "$c"
done
c=$(curl -s -g -D "$T/h" -o "$T/body" -w '%{http_code}' -H 'X-GH: 1' -H 'Content-Type: application/json' --data '{"password":"guess-5"}' "$B6/api/login")
expect "fifth wrong try locks ::1 out" 429 "$c"
contains "lockout says for how long" "Retry-After: 300" "$(cat "$T/h")"
expect "while locked even the right password is refused" 429 "$(curl -s -g -o /dev/null -w '%{http_code}' -H 'X-GH: 1' -H 'Content-Type: application/json' --data "$(pwj "$TVPW")" "$B6/api/login")"
expect "127.0.0.1 is not locked by ::1's failures" 200 "$(api POST /api/login '' "$(pwj "$TVPW")")"
start=$(python3 -c 'import time; print(time.time())')
api POST /api/login '' '{"password":"slow-me-down"}' >/dev/null
end=$(python3 -c 'import time; print(time.time())')
secs=$(python3 -c "print(round($end - $start, 2))")
if python3 -c "import sys; sys.exit(0 if $end - $start >= 1.2 else 1)"; then ok "global slowdown: a wrong try now takes ${secs}s"; else bad "global slowdown" "${secs}s"; fi

echo "storage cap covers thumbnails (runner restarted with a small cap)"
PB=$(wc -c < "$T/photo.jpg" | tr -d ' ')
TB=$(wc -c < "$T/thumb.jpg" | tr -d ' ')
thumb_put() { # file [extra curl args]: PUT it as the thumbnail of $CAP, print the status
  local f=$1; shift
  curl -s -o "$T/body" -w '%{http_code}' -X PUT -b "$J3" -H 'X-GH: 1' -H 'Content-Type: image/jpeg' "$@" --data-binary @"$f" "$B/api/photos/$CAP/thumb"
}
stop_runner
start_runner --max-total-bytes $((PB + TB / 2))
expect "photo within the cap accepted" 201 "$(curl -s -o "$T/body" -w '%{http_code}' -b "$J3" -H 'X-GH: 1' -H 'Content-Type: image/jpeg' --data-binary @"$T/photo.jpg" $B/api/photos)"
CAP=$(json "d['photo']['id']")
expect "thumbnail over the cap refused before it is received" 507 "$(thumb_put "$T/thumb.jpg")"
contains "refusal says the storage is full" '"reason":"bytes"' "$(body)"
expect "chunked thumbnail over the cap refused once complete" 507 "$(thumb_put "$T/thumb.jpg" -H 'Transfer-Encoding: chunked')"
sleep 0.3
expect "refused thumbnails left no files behind" 0 "$(ls -A "$T/data/thumbs" | wc -l | tr -d ' ')"
expect "photo still listed without a thumbnail" "False" "$(api GET /api/photos "$J3" >/dev/null; json "[p['thumb'] for p in d['photos'] if p['id']=='$CAP'][0]")"
stop_runner
start_runner --max-total-bytes $((PB + TB))
expect "thumbnail that fits accepted" 204 "$(thumb_put "$T/thumb.jpg")"
expect "same thumbnail again: replaces the old one, not counted twice" 204 "$(thumb_put "$T/thumb.jpg")"
expect "storage in use is photo + one thumbnail" $((PB + TB)) "$(api GET /api/me "$J3" >/dev/null; json "d['limits']['bytes']")"
expect "bigger replacement thumbnail over the cap refused" 507 "$(thumb_put "$T/thumb-big.jpg" -H 'Transfer-Encoding: chunked')"
expect "the old thumbnail is kept and still served" "200 $TB" "$(curl -s -o /dev/null -w '%{http_code} %{size_download}' -b "$J3" "$B/media/thumbs/$CAP.jpg")"
expect "photo deleted" 200 "$(api DELETE /api/photos/$CAP "$J3")"

echo "fair sign-in queue (runner restarted, so no earlier failures count)"
stop_runner
start_runner
: > "$T/burst"
pids=()
for i in $(seq 1 25); do
  curl -s -g -o /dev/null -w '%{http_code}\n' -H 'X-GH: 1' -H 'Content-Type: application/json' --data '{"password":"burst-guess-'$i'"}' "$B6/api/login" >> "$T/burst" &
  pids+=($!)
done
sleep 0.4
start=$(python3 -c 'import time; print(time.time())')
code=$(api POST /api/login '' "$(pwj "$TVPW")")
end=$(python3 -c 'import time; print(time.time())')
wait "${pids[@]}"
secs=$(python3 -c "print(round($end - $start, 2))")
expect "during a burst of 25 wrong guesses from ::1, 127.0.0.1 still signs in (took ${secs}s)" 200 "$code"
busy=$(grep -c '^503$' "$T/burst")
checked=$(grep -c '^401$' "$T/burst")
# (the old queue let one address take 20 places, so only 5 were refused as busy)
if [ "$busy" -ge 10 ]; then ok "burst: $busy of 25 refused at once as busy (one address gets 2 places)"; else bad "burst refused as busy" "$busy of 25: $(sort "$T/burst" | uniq -c | tr '\n' ' ')"; fi
if [ "$checked" -le 4 ]; then ok "burst: only $checked wrong guesses checked, lockout still applies"; else bad "burst checked" "$checked"; fi

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
