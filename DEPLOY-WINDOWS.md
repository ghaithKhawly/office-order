# Deploying Office Order on an air-gapped Windows box

This is the whole deployment procedure. Print it, or keep a copy on the machine
— **there is no internet there**, so this file is the only documentation you
will have when something goes wrong.

Everything below assumes Windows x64 and Node 22.

---

## The short version

1. On a machine **with** internet: `npm install`, `npm run build`, assemble the
   portable folder.
2. Copy the whole folder to the office machine — `node_modules` included.
3. Give that machine a **static IP** on the router.
4. Run `deploy\open-firewall.bat` as administrator.
5. Run `deploy\install-service.bat` as administrator.
6. Open `http://<the-static-ip>:3001` on a phone. Print the QR from **Setup**.

The rest of this document is why each step is that way, and what to do when one
of them doesn't work.

---

## Why a folder and not a single .exe

**Do not try to build a single binary.** It looks like the obvious answer for an
offline deployment and it is a trap here:

- `better-sqlite3` is a **native addon** — a compiled `.node` file, not
  JavaScript. Node's SEA (Single Executable Application) support does not
  package native addons in any way you would want to depend on.
- `pkg`, which used to be the answer, is **archived and unmaintained**.
- Every workaround ends with the `.node` file sitting next to the executable
  anyway, which is a folder with extra steps and a worse failure mode.

So: ship a folder. It is boring, it is inspectable, and when something breaks
you can see the parts.

```
office-order\
  node\
    node.exe              <- pinned runtime, matching .nvmrc
  app\
    server\
      node_modules\       <- MUST come from a Windows x64 install
      data\               <- database, uploads, backups (created on first run)
    web\dist\             <- built frontend
    ...
  deploy\
    start.bat
    install-service.bat
    open-firewall.bat
    restore-backup.bat
    nssm.exe              <- optional, if not on PATH
  logs\                   <- created by the service
```

---

## Installing without internet

This is the step people get wrong, and the failure is confusing, so read it
carefully.

`better-sqlite3` ships a **prebuilt binary per platform and per Node ABI**. The
copy in `node_modules` is compiled for one operating system, one CPU
architecture, and one Node major version.

> **A `node_modules` from Linux or macOS will not run on Windows.**
> Neither will one built against a different Node major version.
> There is no compiler on the office machine, so it cannot rebuild.

### Do this

On a Windows x64 machine with internet, running **the same Node major version**
as the target (22 — check `.nvmrc`):

```bash
git clone <this repo> office-order/app
cd office-order/app
npm install
npm run build
```

Verify the native module actually loads **on that machine**, before you copy
anything:

```bash
node -e "const D=require('./server/node_modules/better-sqlite3'); new D(':memory:'); console.log('better-sqlite3 OK')"
```

Then get a matching `node.exe`:

- Download the **Windows x64 binary** (`node-v22.x.x-win-x64.zip`) from
  nodejs.org, unzip it, and put `node.exe` in `office-order\node\`.
- Using the same major version as the machine you ran `npm install` on is the
  entire point. Do not "upgrade while you're at it".

Now copy the whole `office-order` folder to the target machine, by USB stick or
network share. **Include `node_modules`.** It is large and it is the part that
cannot be recreated on site.

### Checking it on the target machine

```
cd office-order
node\node.exe -e "console.log(process.version)"
node\node.exe -e "const D=require('./app/server/node_modules/better-sqlite3'); new D(':memory:'); console.log('better-sqlite3 OK')"
```

If the second command fails with `ERR_DLOPEN_FAILED`, `was compiled against a
different Node.js version`, or `not a valid Win32 application`, the
`node_modules` came from the wrong platform or the wrong Node major. Go back and
redo it on Windows x64 with the right version. Nothing else will fix it.

---

## Give the machine a static IP

Do this **before** you print anything.

Everyone reaches the app by IP. Bookmarks, the QR code by the door, and the wall
display URL all contain that address. When DHCP hands the machine a different
one after a reboot, all of them break at once, and it looks like the app died.

Two options, both fine:

- **Reserve it on the router** (preferred): find the machine's MAC address and
  add a DHCP reservation. The machine keeps using DHCP and always gets the same
  address.
- **Set it statically on the machine**: Settings → Network → change adapter
  options → IPv4 properties. If you do this, you must also set the gateway and
  DNS correctly, and pick an address **outside** the router's DHCP pool or you
  will eventually collide with another device.

Find the current address with:

```
ipconfig
```

or read it off the **Setup → Server health** panel in the app, which lists every
address it can see and which adapter each belongs to.

> If the app picks the wrong address for the QR code — common on a machine with
> a VPN client or Hyper-V installed, whose virtual adapters can sort ahead of
> the real one — pin it explicitly in `app\server\.env`:
>
> ```
> PUBLIC_HOST=192.168.1.50
> ```

---

## Firewall

Run as administrator:

```
deploy\open-firewall.bat
```

This adds an inbound TCP allow rule for port 3001 on the **private** profile
only. Without it the app works perfectly on the machine itself and is
unreachable from every phone — which reads like a broken app rather than a
firewall doing its job.

If phones still can't connect, Windows has probably classified the office
network as **Public**. Check and fix:

```
powershell -Command "Get-NetConnectionProfile"
powershell -Command "Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -NetworkCategory Private"
```

---

## Run it as a service

Leaving a terminal window open forever is not a deployment: someone closes it,
or the machine reboots overnight and nobody notices until lunch.

**NSSM** (the Non-Sucking Service Manager) runs any executable as a proper
Windows service. It is a single `.exe` with no installer — download it once from
nssm.cc on a machine with internet and drop it next to the scripts, or put it on
PATH.

Run as administrator:

```
deploy\install-service.bat
```

That installs the service, sets it to start with Windows, restarts it if it ever
exits, and writes logs to `logs\service.log` with rotation at 10 MB.

The exact commands it runs, if you prefer to do it by hand:

```
nssm install OfficeOrder "C:\office-order\deploy\start.bat"
nssm set OfficeOrder AppDirectory "C:\office-order\app"
nssm set OfficeOrder DisplayName "Office Order"
nssm set OfficeOrder Start SERVICE_AUTO_START
nssm set OfficeOrder AppExit Default Restart
nssm set OfficeOrder AppRestartDelay 5000
nssm set OfficeOrder AppStdout "C:\office-order\logs\service.log"
nssm set OfficeOrder AppStderr "C:\office-order\logs\service.log"
nssm set OfficeOrder AppRotateFiles 1
nssm set OfficeOrder AppRotateOnline 1
nssm set OfficeOrder AppRotateBytes 10485760
nssm set OfficeOrder AppEnvironmentExtra NSSM_SERVICE=1
nssm start OfficeOrder
```

Day-to-day:

```
nssm status  OfficeOrder
nssm restart OfficeOrder
nssm stop    OfficeOrder
nssm edit    OfficeOrder          (opens the GUI)
nssm remove  OfficeOrder confirm  (uninstall)
```

---

## Configuration

Copy `.env.example` to `app\server\.env` **before the first run** and edit it.

| Setting | Why you care |
|---|---|
| `JWT_SECRET` | Signs login tokens. Change it. Anything long and random. |
| `ADMIN_PASSWORD` | The bootstrap admin, created only when the database is empty. Change it from Setup after first login. |
| `PORT` | Default 3001. If you change it, update the firewall rule too. |
| `PUBLIC_HOST` | Forces the address used in the QR code and join URL. Set this once the machine has its static IP. |
| `BACKUP_INTERVAL_HOURS` | Default 6. |
| `BACKUP_KEEP` | Default 14 snapshots. |
| `DATA_DIR` | Where the database, uploads and backups live. Leave it alone unless you have a reason. |

---

## Backups

The app takes its own snapshots every `BACKUP_INTERVAL_HOURS` into
`app\server\data\backups\`, keeps the most recent `BACKUP_KEEP`, and shows the
age of the last good one in **Setup**, in red once it goes stale.

**Get copies off the machine.** A backup that only exists on the disk that
failed is not a backup. Once a week, use **Setup → Download database** and put
the file on a USB stick or a network share.

> ### Never back up by copying `app.db`
>
> The database runs in WAL mode. Recent transactions live in `app.db-wal`, not
> in `app.db`, so a copy of `app.db` alone is not merely stale — it can be
> **structurally unusable**. This was measured on this build: with ~1 MB sitting
> in the WAL, a plain file copy opened with *"no such table: restaurants"*,
> while the app's own snapshot was complete and valid.
>
> The app uses `VACUUM INTO`, which asks SQLite for a consistent copy while it
> holds the right locks. Use the button, or stop the service before copying
> anything by hand.

### Restoring

```
deploy\restore-backup.bat
```

with no arguments lists the available snapshots. Pass one to restore it:

```
deploy\restore-backup.bat "C:\office-order\app\server\data\backups\app-2026-08-13-0900.db"
```

It stops the service, keeps the current database as `app.db.replaced-{stamp}`,
removes the stale `-wal` and `-shm` files (leaving them would let SQLite apply
one database's journal over another — genuinely destructive), copies the backup
into place, and starts the service again.

---

## It's broken. What do I do?

Work down this list. Most problems are one of the first three.

### 1. Is the service running?

```
nssm status OfficeOrder
```

Anything other than `SERVICE_RUNNING`:

```
nssm restart OfficeOrder
```

Then read the log — it is the only account of what happened:

```
notepad C:\office-order\logs\service.log
```

### 2. Can the machine itself reach the app?

On the machine, open `http://localhost:3001`.

- **Works locally but not from phones** → firewall or network profile. Go back
  to the firewall section. Also confirm the phones are on the same network and
  not a guest wifi that isolates clients.
- **Doesn't work locally either** → the server isn't running. Continue.

### 3. Read the health page

**Setup → Server health**, in the app. It reports uptime, database size, free
disk, last backup, connected clients, Node version, and every address the
machine has. When there is no internet to search from, this is the closest thing
to a diagnosis.

Look for: database integrity not `ok`, free disk near zero, a last backup
measured in days.

### 4. Common failures

| What you see | What it is |
|---|---|
| `EADDRINUSE` in the log | Something already has port 3001 — usually the app running twice. `nssm status OfficeOrder`, and `netstat -ano \| findstr :3001` to find the other one. |
| `ERR_DLOPEN_FAILED`, `compiled against a different Node.js version`, `not a valid Win32 application` | Wrong `node_modules`. See "Installing without internet". |
| Page loads but Arabic looks wrong | The vendored fonts didn't ship. Confirm `app\web\dist\fonts\` contains `.woff2` files. Rebuild with `npm run build`, which fails if fonts are missing. |
| Phones can reach it, then can't, after a reboot | DHCP gave the machine a new address. Set a static IP / reservation. |
| Nobody can log in, "too many attempts" | Login rate limit, 20 failures per 15 minutes per device. It is held in memory: `nssm restart OfficeOrder` clears it instantly, or wait 15 minutes. |
| Disk full | Old backups and menu photos. `app\server\data\backups\` and `app\server\data\uploads\`. Lower `BACKUP_KEEP`. |
| Database integrity not `ok` on the health page | Stop the service and restore the most recent good backup. Do not keep writing to it. |

### 5. Last resort

Restore from the newest backup (above). If the database itself is fine and the
install is suspect, re-copy the folder from the build machine — the data lives
in `app\server\data\`, so keep that and replace everything else.

---

## Upgrading

1. Build the new version on the internet-connected Windows machine, same Node
   major version.
2. `nssm stop OfficeOrder`
3. **Copy `app\server\data\` out of the way**, or copy the new build over the
   top without deleting it. That folder is the database, the menu photos, and
   the backups.
4. Replace the rest of `app\`.
5. `nssm start OfficeOrder`
6. Check **Setup → Server health**.

Migrations run automatically on start and only ever add to the schema, so an
upgrade does not need a data migration step. Take a backup first anyway — it
costs one click.
