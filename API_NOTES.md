# Bambu Cloud API notes

Bambu Lab does not publish a cloud API. Everything below comes from community
reverse-engineering plus a few unauthenticated probes made while building this
app (November 2026). Treat it as a working map, not a contract. Bambu can and
does change these endpoints without notice.

**Legend:** ✅ verified (by us or by several independent sources), ⚠️ reported by
one source / partly verified, ❓ unknown or guessed: **don't rely on it**.

## Sources reviewed

| Source | What it covers |
|---|---|
| [Doridian/OpenBambuAPI](https://github.com/Doridian/OpenBambuAPI) | `cloud-http.md`, `mqtt.md`, `cloud-makerworld.md`, `cloud-x509-auth.md`, `client-plugin-internals.md`, `cloud-video.md` |
| [greghesp/ha-bambulab](https://github.com/greghesp/ha-bambulab) (Home Assistant) | `pybambu/bambu_cloud.py` (login, email code, 2FA, CSRF fallback), `models.py` (status parsing, authorization flags), README firmware table |
| [coelacant1/Bambu-Lab-Cloud-API](https://github.com/coelacant1/Bambu-Lab-Cloud-API) | Python client. Its cloud-print code looks speculative, so we don't rely on it |
| [estampo/boo-cloud](https://github.com/estampo/boo-cloud) `docs/cloud-print-research.md`, `docs/signed-app-gate.md` | The most detailed public capture of the cloud print REST flow (March 2026) and of the signing gate |
| Bambu wiki: [third-party integration](https://wiki.bambulab.com/en/software/third-party-integration) | Bambu's official position: Bambu Connect is the sanctioned middleware |

---

## 1. Hosts

| Purpose | Global | China |
|---|---|---|
| REST API | `https://api.bambulab.com` ✅ | `https://api.bambulab.cn` ⚠️ |
| Website (2FA leg) | `https://bambulab.com` ✅ | `https://bambulab.cn` ⚠️ |
| Cloud MQTT | `us.mqtt.bambulab.com:8883` (TLS) ✅ | `cn.mqtt.bambulab.com:8883` ⚠️ |
| MakerWorld images | `makerworld.bblmw.com` ✅ | ❓ |

`makerworld.com/api/v1/...` mirrors the design endpoints but sits behind
Cloudflare bot protection. Use `api.bambulab.com` instead.

**Cloudflare risk ⚠️:** ha-bambulab has seen Cloudflare 403/429 challenge pages
from the API hosts and ships a `cloudscraper` fallback. Our probes from a cloud
container got normal JSON back. Vercel egress IPs could still be challenged at
some point. The proxy detects an HTML challenge page and reports
`UPSTREAM_BLOCKED` instead of a confusing parse error.

---

## 2. Login

### 2.1 Password login ✅

```
POST /v1/user-service/user/login
{"account": "<email or phone>", "password": "<password>", "apiError": ""}
```

Possible outcomes:

| Response | Meaning | Next step |
|---|---|---|
| `{"accessToken": "...", "refreshToken": "...", "expiresIn": 7776000, ...}` | Logged in. `expiresIn` is about 90 days | Done |
| `{"loginType": "verifyCode", ...}` | New device or location. Bambu wants an emailed or SMS code | 2.2 |
| `{"loginType": "tfa", "tfaKey": "..."}` | Account has an authenticator app (TOTP) enabled | 2.3 |
| HTTP 400 `{"code": 1, "error": "Incorrect account or password."}` | Bad credentials (we saw this live) | Show error |

People who signed up with Google, Apple, or Facebook have no password. They
need to set one in Bambu Handy (Account Security → Change Password) first.
ha-bambulab gives the same advice.

### 2.2 Email / SMS verification code ✅

Request a code (or a new one):

```
POST /v1/user-service/user/sendemail/code   {"email": "<email>", "type": "codeLogin"}
POST https://bambulab.cn/api/v1/user-service/user/sendsmscode   {"phone": "<phone>", "type": "codeLogin"}   ⚠️ SMS is China-only
```

Then log in with the code instead of the password:

```
POST /v1/user-service/user/login   {"account": "<email>", "code": "123456"}
```

* 200 → `accessToken` as above.
* 400 with `code: 1` → code expired. ha-bambulab requests a new one automatically.
* 400 with `code: 2` → code incorrect.

❓ It's unclear whether a `verifyCode` login response already triggers the email.
ha-bambulab doesn't request one explicitly in that case, which suggests it does.
Our UI never sends one on its own. It offers a "Send me a code" button so the
user decides.

### 2.3 Two-factor (TOTP) ⚠️

```
GET  https://bambulab.com/api/csrf            → 204 + Set-Cookie: bbl_csrf_token=...
POST https://bambulab.com/api/sign-in/tfa     {"tfaKey": "...", "tfaCode": "123456"}
     headers: x-bbl-csrf-token: <cookie value>, Cookie: bbl_csrf_token=<value>
→ 200, token arrives as a `token` **cookie**, not in the JSON body
```

This leg runs on the *website* host and has broken twice: the CSRF path moved,
and later a `missing_cookie` 403. ha-bambulab's fallback, which we copy: if the
2FA leg fails with a CSRF error, request an email code and continue with 2.2.
boo-cloud records a different endpoint (`POST /v1/user-service/user/tfa`) ❓.
We haven't confirmed it, so we don't use it.

### 2.4 Token refresh ❌

`POST /v1/user-service/user/refreshtoken` exists, but OpenBambuAPI reports it
now always returns 401. The refresh token equals the access token anyway.
**There's no working refresh.** The access token lasts about 90 days. When the
API starts returning 401, we clear the session and send the user back to login
with an "expired" message.

### 2.5 User id ✅

The MQTT username is `u_<uid>`. Newer tokens are no longer JWTs carrying
`username`, so we fetch the uid once at login:

```
GET /v1/design-user-service/my/preference   → {"uid": 1234567890, "name": ..., "avatar": ...}
```

If the token *is* a JWT, `payload.username` is already `u_<uid>`. We try that
first.

### 2.6 Request headers

ha-bambulab sends `X-BBL-Client-Name/Type/Version`, `X-BBL-Language`, and
`X-BBL-OS-Type`. Most endpoints don't check them. We identify honestly as
`bambu-handy-web` (see `lib/bambu/http.ts`). One exception (see §5): creating a
cloud print task reportedly needs Bambu Connect's client headers.

---

## 3. Devices, status, AMS

### 3.1 Device list ✅

```
GET /v1/iot-service/api/user/bind
→ devices[]: dev_id, name, online, print_status, dev_model_name, dev_product_name,
             dev_access_code, nozzle_diameter, dev_structure, print_job
```

* `dev_model_name` is the internal code: `BL-P001` (X1C), `BL-P002` (X1), `C11`
  (P1P), `C12` (P1S), `C13` (X1E), `N1` (A1 mini), `N2S` (A1), `O1D` (H2D),
  `O1S` (H2S), and so on. Newer models may return the marketing name here
  instead ⚠️.
* `dev_access_code` is the printer's LAN password. **The proxy strips it before
  anything reaches the browser.** We never need it.

### 3.2 Coarse status over REST ✅

```
GET /v1/iot-service/api/user/print?force=true
→ devices[]: dev_id, dev_online, task_id, task_name, task_status, progress,
             prediction, start_time, thumbnail, ...
```

The REST call is cheap and works on the Vercel Edge runtime. The printer list
uses it for a quick "Printing 42%" summary without opening MQTT. ⚠️ How fresh
`progress` is varies. Field names come from captures that mostly showed
nulls.

### 3.3 Live status over cloud MQTT ✅

* Broker `us.mqtt.bambulab.com:8883`, TLS, username `u_<uid>`, password = access token.
* Subscribe `device/<dev_id>/report`. Publish `device/<dev_id>/request`.
* Send `{"pushing": {"sequence_id": "0", "command": "pushall", "version": 1, "push_target": 1}}`
  to get a full snapshot. `pushing.*` commands **don't need signing**, even on
  current firmware ✅ (OpenBambuAPI, boo-cloud, ha-bambulab all agree).
* X1/H2 machines push the full object about once a second. P1/A1 machines push
  **deltas only**, so the client merges them into the last full snapshot.
* ⚠️ OpenBambuAPI warns against sending `pushall` to a P1P more often than about
  every 5 minutes because it makes the printer lag. Our polling sends `pushall`
  only on the first poll and then every 5 minutes. Other polls just listen for
  a few seconds and merge deltas.

Fields we use from `print` (push_status):

| Field | Meaning |
|---|---|
| `gcode_state` | `IDLE`, `PREPARE`, `RUNNING`, `PAUSE`, `FINISH`, `FAILED`, `SLICING` |
| `mc_percent` | progress % |
| `mc_remaining_time` | minutes remaining |
| `layer_num` / `total_layer_num` | layers |
| `nozzle_temper` / `nozzle_target_temper`, `bed_temper` / `bed_target_temper`, `chamber_temper` | temperatures (°C) |
| `subtask_name`, `task_id`, `project_id`, `profile_id` | job identity |
| `print_error`, `mc_print_error_code` | error codes (0 = none) |
| `hms[]` | `{attr, code}` health-management alerts. Wiki URL: `https://wiki.bambulab.com/en/x1/troubleshooting/hmscode/<code>` ⚠️ |
| `ams.ams[].tray[]` | AMS trays (below) |
| `vt_tray` | external spool (id `254`) |
| `fun` (hex string) / `flag3` (int) | authorization flags (§6) |
| `ipcam` | camera presence / timelapse state |

AMS tray entry ✅: `id` (slot 0-3 within the unit), `tray_type` (e.g. `PLA`),
`tray_color` (`RRGGBBAA` hex), `cols[]` (multi-color filament), `tray_info_idx`
(filament id like `GFA00`), `tray_sub_brands`, `remain` (% or -1),
`nozzle_temp_min/max`. An entry with only `id` means an empty slot. A global
tray index is `ams_id * 4 + slot`. `tray_now` = `254` means external spool,
`255` means none.

H2D/H2C dual-nozzle machines add `ams.ams[].info` / nozzle bits for which
extruder an AMS feeds ⚠️. We show those trays but don't do nozzle-aware
mapping.

### 3.4 Camera ❓ (mostly not feasible in a browser)

* X1/P2S/H2: RTSPS on the printer, port 322 (**LAN only**).
* P1/A1: proprietary JPEG stream on TCP 6000 (**LAN only**).
* Remote viewing goes through ThroughTek Kalay (TUTK) P2P using
  `POST /v1/iot-service/api/user/ttcode`, or through Agora. Both need native SDKs
  and can't run in a browser or a stateless function.
* **What we can do:** show the job's cover / plate thumbnail (`thumbnail` from
  §3.2, task `cover` from `/v1/user-service/my/tasks`). There's no live camera
  snapshot. README "Known limitations" covers this.

---

## 4. MakerWorld

All verified live with **no auth** (November 2026) unless noted:

| Purpose | Endpoint |
|---|---|
| Category / trending feed ✅ | `GET /v1/search-service/select/design/nav?navKey=Trending&offset=0&limit=20` → `{total, hits[]}` |
| Keyword search ✅ | `GET /v1/search-service/select/design2?keyword=<q>&offset=0&limit=20` → `{total, hits[]}` |
| Design detail ✅ | `GET /v1/design-service/design/<designId>` → `title, coverUrl, summary (HTML), designCreator, modelId, defaultInstanceId, instances[]` |
| 3MF download 🔒 | `GET /v1/design-service/instance/<instanceId>/f3mf?type=download` (returns 403 "Please log in" without a token) |

Feed hit fields: `id, title, cover, designCreator{name, avatar}, likeCount,
downloadCount, printCount, is_printable, nsfw, tags`. Other known `navKey`s
⚠️: `category_400` (Toys & Games), `category_800` (Home & Living).

**Instances = print profiles ✅.** Each `instances[]` entry is one creator-made
print profile:

* `id` (instanceId), `profileId`, `title`, `cover`, `isDefault`, `appCanPrint`,
  `needAms`, `materialCnt`
* `prediction` (seconds), `weight` (g)
* `instanceFilaments[]`: `{type, color, usedM, usedG}`
* `extention.modelInfo.compatibility`: `{devModelName, devProductName, nozzleDiameter}`
  is the printer it was sliced for
* `extention.modelInfo.otherCompatibility[]`: other printers MakerWorld says can
  print it
* `extention.modelInfo.plates[]`: `{index, name, thumbnail.url, prediction,
  weight, filaments[{id, type, color, usedG, usedM}]}`

**Watch out:** plate filament `id`s are the project's filament slots (1-based)
and **can skip numbers** (we saw `1, 2, 4, 5`). The AMS mapping array is indexed
by `id - 1`.

**Compatibility rule we apply:** a printer is "compatible" if its
`dev_model_name` matches `compatibility.devModelName` or any
`otherCompatibility[].devModelName`, *and* its nozzle diameter matches. Anything
else gets "Not sliced for this printer". ❓ We don't know whether MakerWorld
re-slices on the server when Handy prints to an `otherCompatibility` printer,
or whether those entries are only hints.

---

## 5. Submitting a cloud print

### 5.1 What Bambu Connect / Studio do (boo-cloud capture, March 2026) ⚠️

For a **local file**, the REST half of the flow is:

1. `POST /v1/iot-service/api/user/project {"name": "file.3mf"}` → `project_id, model_id, profile_id, upload_url, upload_ticket`
2. `PUT <upload_url>` with a config-only 3MF (**no** `Content-Type` header, or the S3 signature breaks)
3. `PUT /v1/iot-service/api/user/notification {"action": "upload", "upload": {"ticket": "...", "origin_file_name": "..."}}`
4. Poll `GET /v1/iot-service/api/user/notification?action=upload&ticket=...` until it stops reporting `running`
5. `GET /v1/iot-service/api/user/upload?model_id=..&profile_id=..&project_id=..&filename=..&md5=..&size=..` → gcode upload URL
6. `PUT` the sliced `.gcode.3mf`
7. `PATCH /v1/iot-service/api/user/project/<id>` with `profile_print_3mf: [{md5, plate_idx, url}]`
8. `POST /v1/user-service/my/task {deviceId, modelId, profileId(int), plateIndex, title, cover, mode: "cloud_file"}` → task id.
   Reportedly needs Bambu Connect client headers ⚠️.

Then the **MQTT half**, the command that actually starts the printer:

```json
{"print": {"sequence_id": "1", "command": "project_file",
  "param": "Metadata/plate_<n>.gcode", "url": "<signed https URL of the .gcode.3mf>", "md5": "...",
  "project_id": "...", "profile_id": "...", "task_id": "...", "subtask_id": "0", "subtask_name": "...",
  "bed_type": "auto", "bed_levelling": true, "flow_cali": true, "vibration_cali": true,
  "layer_inspect": true, "timelapse": false,
  "use_ams": true, "ams_mapping": [ ... ], "ams_mapping2": [ ... ]}}
```

boo-cloud reports that **creating the task alone doesn't start anything**. The
printer only starts on the `project_file` MQTT command.

### 5.2 MakerWorld instances ❓

A MakerWorld instance already lives in the cloud as a model and profile, so
steps 1-7 shouldn't be needed. Our best-evidence plan, **unverified end to
end**:

* `GET /v1/iot-service/api/user/profile/<profileId>?model_id=<modelId>` → `url`, `md5`, and `context.plates[].gcode.url`. The response shape is documented in OpenBambuAPI. Whether it works for *other people's* public profiles is unknown ❓.
* Fallback: `GET /v1/design-service/instance/<instanceId>/f3mf?type=download` (authenticated). We don't know whether this 3MF includes sliced G-code ❓. If it doesn't, we can't print it without a slicer, and we tell the user so.
* Create the task (step 8) with `designId`/`instanceId` added, then publish `project_file`.

### 5.3 AMS mapping ⚠️

* `ams_mapping`: an array indexed by project filament slot (`filament id - 1`).
  Each value is the global tray index `ams_id * 4 + slot`, `254` for the
  external spool, or `-1` for "slot unused".
* `ams_mapping2` (newer firmware/slicers): the same thing as objects,
  `{"ams_id": n, "slot_id": m}` (`ams_id: 255, slot_id: 0` for external).
* OpenBambuAPI describes a fixed five-element, right-aligned layout. That
  doesn't match what Bambu Studio sends, so we follow the Studio-style layout
  above ❓.
* `use_ams: false` plus an empty mapping means print from the external spool.
* If the mapping is wrong, the printer pauses and waits instead of starting
  (OpenBambuAPI). That's why we validate filament *type* matches before
  sending (§7 "AMS mismatch").

---

## 6. Firmware authorization: who still accepts cloud commands

### What changed ✅

Since January 2025, Bambu firmware uses an "authorization control" system:

* **`print.*` commands** (start, pause, resume, stop, `project_file`, …) must
  carry an RSA-SHA256 `header` signed with a per-installation X.509 certificate
  that Bambu issues to its own apps (Studio, Handy, Connect).
* Unsigned `print.*` commands are rejected with `mqtt message verify failed`
  (`err_code 0x05024007` with no envelope, `0x05024009` with a bad envelope),
  or dropped silently. This applies on LAN and **through the cloud broker**.
* **Status (`pushing.pushall`, report subscription) is unaffected.** Reading
  live status still works for unofficial clients ✅.
* The signing key is protected: obfuscated in Bambu's network plugin, which
  also checks it is running inside genuine signed Bambu binaries. A leaked
  Bambu Connect key from January 2025 was per-installation and now returns
  403.

### Firmware thresholds (from ha-bambulab's feature table) ⚠️

| Printer | Signing required from firmware |
|---|---|
| X1 / X1C | 01.08.05.00 per README; code checks `01.08.50.32` (newer track) |
| X1E | unknown ❓ |
| P1P / P1S | 01.08.02.00 |
| A1 / A1 mini | 01.05.00.00 |
| H2D / H2D Pro | 01.01.00.00 (shipped with it) |
| P2S, H2S, H2C, X2D, A2L, H3C and later models | shipped with it: assume **always** required |

### How to tell at runtime ✅ (more reliable than version numbers)

From any full `push_status`:

* `print.fun` (hex string): bit `0x20000000` set means signing required.
  Clearing it is how "Developer Mode" shows up.
* If `fun` is empty, `print.flag3` (int) bit `0x10` set means authorization
  control is on.

### What this app does

* We **don't** obtain, extract, or emulate Bambu's signing certificates, and we
  **don't** patch or hook Bambu software. Bambu has threatened legal action
  over exactly that (the shuttered OrcaSlicer-BambuLab plugin), and it would
  mean trusting a public web app with a credential that can control your
  printer. This is a deliberate line.
* Before sending, the print flow reads the printer's flags over MQTT:
  * **No authorization control** (old firmware): we send the unsigned
    `project_file` command. This should work. ⚠️ This path isn't verified end
    to end on real hardware.
  * **Authorization control on**: we **don't send**. We show a clear
    "Firmware blocks third-party printing" screen that explains why and gives
    the options: (a) start the job from Bambu Handy or Bambu Studio on another
    device; (b) on a computer, MakerWorld's "Open in Bambu Studio" or Bambu
    Connect; (c) LAN-only Developer Mode, which removes the check but also
    disconnects the printer from the cloud, so this app can't reach it either.
  * **Unknown** (status didn't arrive in time): we warn and let the user try.
    If the printer reports `verify failed`, we show the same blocked screen.
* Monitoring (Phase 2) works either way.

**Bottom line for users:** on current firmware, this app can log in, browse
MakerWorld, and show live status for every printer. Starting prints only works
on printers whose firmware predates authorization control, or where Bambu
someday opens a sanctioned remote-print API. We'll update this file if that
happens.

---

## 7. Error mapping used by the app

| Situation | Detected by | UI state |
|---|---|---|
| Expired / revoked token | HTTP 401 from any Bambu REST call, or MQTT CONNACK "not authorized" | Session cleared → login screen with "Your Bambu session expired" |
| Printer offline | `online: false` in `/user/bind`, or no MQTT report within the window | "Printer offline" badge, print button disabled |
| Firmware blocks third-party control | `fun`/`flag3` bits (§6), or `verify failed` / `err_code 0x0502400x` in a report | "Firmware blocks third-party printing" panel |
| AMS mismatch | Mapped tray's `tray_type` ≠ plate filament `type`, or a needed tray is empty | Per-row warning; sending needs explicit confirmation |
| Cloudflare / upstream block | HTML body or 403/429 with `cloudflare` from the API host | "Bambu's servers refused the request from this deployment" |
