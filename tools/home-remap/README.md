# Remapping the Home button to Glass Home (The Frame)

By default the remote's **Home** button opens Samsung's Smart Hub — there is no
public web-app API to change that. On a TV in **Developer Mode** this toolkit
points the Home button at Glass Home instead, so one press lands on your own
home screen (ads and all of Smart Hub a second press away via the dock's
**Samsung Home** tile).

> **This is advanced, unsupported, and reversible only with a baseline you save
> first.** It writes undocumented platform preferences on your TV. It was built
> and tested on **one** set — a 2022 Samsung The Frame (`QN50LS03BAGXZD`,
> "Monalisa"), firmware `T-PTMUABC-1720.7`, Tizen 6.5, armv7/32-bit. Other
> models, years and firmware are untested. Read all of this before running
> anything. If you are not comfortable recovering a TV whose Home button points
> somewhere unexpected, stop here — the in-app **Samsung Home** tile already
> gives you Samsung's screen without touching any of this.

## What it actually changes

Two platform values decide which app the physical Home button resolves to. The
helper writes **only** these, and nothing else:

| Setting | From (example) | To |
| --- | --- | --- |
| the `main` app-control operation (`app_operation_set_current_app`) | `com.samsung.tv.csfs` | `GlassHome1.GlassHome` |
| `db/appfw/home_appid` (vconf) | `com.samsung.tv.csfs` | `GlassHome1.GlassHome` |

It deliberately leaves `db/menu/smart_hub/ontvsetting/auto_start` and the other
startup keys untouched. **This remaps the Home _button_, not power-on.** Making
the TV cold-start into Glass Home is a separate, riskier change this toolkit does
not make.

Every write is read back; `apply` refuses unless the live values still match the
baseline you captured, and auto-rolls-back if any step fails.

## Why it needs an exploit at all

`sdb capability` on this TV reports `intershell_support:disabled`, so a normal
`sdb shell <cmd>` runs nothing useful and `sdb pull /etc/*` is blocked. The only
way to run code as the SDK user (UID 901, no root) is the well-known
`0 appinstall` package-name command-execution path: the package "name" carries a
backtick expansion the installer's parser evaluates. `remap.py` uses it to run a
staged script and stream its output back over a TCP socket.

This is a **self-modding technique for a TV you own**, not a remote exploit: it
requires Developer Mode switched on at the TV, your computer registered as the
TV's **Host PC IP**, and `sdb` reachable on your LAN. The method follows the
prior public work in [CleanFrame](https://github.com/nthnclrk/CleanFrame),
[arn0-tv](https://github.com/NelsonEU/arn0-tv) and
[couchroot (s90d)](https://github.com/splitcipher/couchroot).

## Prerequisites

- Glass Home already **installed** on the TV, and the TV in **Developer Mode**
  (same setup as the main install — see [../../docs/INSTALL.md](../../docs/INSTALL.md)).
- `sdb` from Samsung's Tizen SDK (`~/tizen-studio/tools/sdb`), reachable TV.
- The **.NET SDK** to compile the helper (any recent version can target
  `netcoreapp3.1`). No-sudo install: `curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0 --install-dir ~/.dotnet`
- `export TV_IP=<your TV's address>` (and optionally `export TV_MODEL=<modelName>`
  for an extra guard; find it at `http://<TV_IP>:8001/api/v2/`).

## Steps

**1. Learn your firmware and current Home values (read-only).**

```sh
export TV_IP=192.168.1.50          # your TV
python3 remap.py inspect
```

Note the `Version=...` string and the five `HOME_PREFERENCES` values. Confirm
`/usr/bin/dotnet` and the native libraries are listed, and that `GlassHome1`
appears under `LAUNCHER_PATHS`.

**2. Set your firmware guard and build the helper.**

Edit `ctl/Control.cs` and set `Firmware` to the exact `Version=` string from
step 1 (e.g. `T-PTMUABC-1720.7`). Then:

```sh
(cd ctl && ~/.dotnet/dotnet build -c Release -o out)
```

**3. Query through the helper and save a baseline (still read-only).**

```sh
python3 remap.py query
```

Copy the JSON after `GHHOME_JSON=` into `baseline.json` (this file is
`.gitignore`d — it is per-device; keep a copy somewhere safe off this machine
too). It looks like:

```json
{"HomeOperation":"com.samsung.tv.csfs","HomeAppid":"com.samsung.tv.csfs","BootSupported":1,"Uid":901}
```

If `BootSupported` is `0`, stop — your launcher is not eligible and `apply` will
refuse anyway.

**4. Apply.**

```sh
python3 remap.py apply baseline.json
```

Success prints `GHHOME_APPLIED=` with both values now `GlassHome1.GlassHome`.
Press **Home** on the remote — it should open Glass Home.

**5. Know your way back.**

```sh
python3 remap.py restore baseline.json
```

restores the original values. If the Home button ever misbehaves, the dock's
**Samsung Home** tile opens Samsung's Smart Hub so you can still reach the TV's
menus (and Developer Mode) — which is exactly why that tile exists.

## Recovery

- **Home goes somewhere unexpected, TV otherwise fine:** run `restore`.
- **Can't reach the TV over `sdb`:** open Glass Home, use the **Samsung Home**
  tile to get to Samsung's menus, and check Developer Mode / network there.
- **A firmware update** can change or undo any of this. Re-run `inspect` after
  any update before assuming the state is what you left. The firmware guard will
  refuse to `apply` against a version you have not set.

## Files

- `inspect.sh` — read-only probe (firmware, Home prefs, runtime, libs).
- `ctl/Control.cs`, `ctl/ctl.csproj` — the guarded native helper (query/apply/restore).
- `remap.py` — stages and runs the above on the TV via the `0 appinstall` path.
