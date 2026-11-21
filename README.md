# Bambu Web Remote (unofficial)

An open-source web app that brings the core of the **Bambu Handy** mobile app
to any browser. It's for people whose devices can't install Handy or Bambu
Studio: Chromebooks, the Xbox Edge browser, school and work laptops, and
locked-down tablets.

> **Unofficial.** This project is independent. It is not affiliated with,
> endorsed by, or supported by Bambu Lab. It relies on undocumented APIs that
> can change or break at any time. "Bambu Lab", "Bambu Handy" and "MakerWorld"
> are trademarks of their respective owners.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2F3devann-lab%2Fbambu-handy-web&project-name=bambu-web-remote&repository-name=bambu-web-remote)

## Status

| Phase | Feature | State |
|---|---|---|
| 0 | API research → [`API_NOTES.md`](API_NOTES.md) | ✅ |
| 1 | Log in (password, email code, 2FA) + printer list | ✅ |
| 2 | Live status (progress, layer, temps, AMS, errors) | ⏳ next |
| 3 | Browse & search MakerWorld | ⏳ |
| 4 | Send a print with AMS filament mapping | ⏳ (see firmware limits below) |

## Privacy model

**No database. No analytics. No third-party scripts. Nothing stored on the server.**

```
 Your browser                      This app (Vercel function)            Bambu Lab
 ────────────                      ──────────────────────────            ─────────
 email + password ──HTTPS──▶ /api/auth/login ──HTTPS──▶ api.bambulab.com/…/user/login
                                   (forwards, then forgets)                      │
                ◀── Set-Cookie: bhw_session=<AES-GCM(token)> ◀── accessToken ───┘
                    httpOnly · Secure · SameSite=Strict

 GET /api/printers ──cookie──▶ decrypt cookie → Authorization: Bearer … ──▶ /iot-service/api/user/bind
                ◀──── printer list (LAN access codes stripped) ◀──────────────┘
```

* **Credentials** reach the server once, are forwarded to Bambu's own login
  endpoint, and are dropped when the request ends. They're never written
  anywhere.
* **The access token** goes into an encrypted, `httpOnly`, `Secure`,
  `SameSite=Strict` cookie in *your* browser. Page JavaScript can't read it. The
  server decrypts it per request and forgets it again. Logging out deletes the
  cookie.
* **Nothing is logged.** Tokens only travel in the `Authorization` header,
  never in URLs, so they can't land in access logs. Error handling logs only an
  error class name.
* **No third parties.** A strict Content-Security-Policy (`next.config.ts`)
  only allows scripts and connections to this site's own origin. Images load
  directly from Bambu/MakerWorld CDNs with `Referrer-Policy: no-referrer`.
* **Printer LAN access codes** returned by Bambu are removed before they reach
  the browser.

### Check it yourself

| Claim | Where to look |
|---|---|
| Cookie encryption, flags, and lifetime | [`lib/session.ts`](lib/session.ts) |
| Every request to Bambu, with no logging | [`lib/bambu/http.ts`](lib/bambu/http.ts) |
| Login steps | [`lib/bambu/auth.ts`](lib/bambu/auth.ts), [`app/api/auth/`](app/api/auth) |
| Access codes stripped | [`lib/bambu/devices.ts`](lib/bambu/devices.ts) |
| CSP and security headers | [`next.config.ts`](next.config.ts) |
| No other server routes exist | [`app/api/`](app/api) |

When you use someone else's deployment, you're trusting that it runs this code
unmodified. The safest option is **your own deployment** (free, about two
minutes).

## Deploy your own (Vercel)

1. Click **Deploy with Vercel** above and sign in to a free Vercel account.
2. Accept the defaults. **No environment variables are required.**
3. Open the URL Vercel gives you and log in with your Bambu Lab account.

Optional: set `SESSION_SECRET` (any long random string, e.g.
`openssl rand -base64 32`) under *Project → Settings → Environment Variables*.
Without it, a random key is generated at every build, so redeploying logs
everyone out. That's harmless, just a little inconvenient. See
[`.env.example`](.env.example).

## Run locally

Requires Node.js 20.9+.

```bash
npm install
```

```bash
npm run dev
```

Open <http://localhost:3000>. To check a production build:

```bash
npm run build && npm start
```

## Logging in

* **Email + password.** Bambu may then email a **verification code**
  (new device or location) or ask for an **authenticator (2FA) code**. Both
  steps are supported.
* **"Email me a login code instead"** skips the password and logs in with an
  emailed code.
* Signed up with **Google, Apple, or Facebook**? Set a password first in Bambu
  Handy: Account Security → Change Password.
* Pick **China** as the region for `bambulab.cn` accounts. The China region is
  less tested.
* Sessions last up to about 90 days (Bambu's token lifetime). Bambu offers no
  working token refresh, so you'll be asked to log in again when it expires.

## Accessibility and low-end devices

* No CSS framework, no web fonts, no 3D. Pages are server-rendered with small
  client components.
* Tap targets are at least 56 px, with large high-contrast focus rings.
* **Keyboard, remote, and game controller:** arrow keys or the D-pad move focus
  spatially. On a gamepad, **A** activates and **B** goes back
  ([`components/SpatialNav.tsx`](components/SpatialNav.tsx)).
* Respects `prefers-reduced-motion`.

## Known limitations

* **Unofficial APIs.** Everything depends on reverse-engineered endpoints. See
  [`API_NOTES.md`](API_NOTES.md), which marks what's verified and what isn't.
* **Printing on current firmware is blocked by Bambu.** Since 2025, Bambu's
  firmware requires `print` commands to be signed by Bambu's own apps.
  Third-party apps can still **read** status but can't **start** prints on
  printers with authorization control enabled. This app won't work around that
  by extracting or emulating Bambu's keys. When a printer refuses, the app says
  so clearly and points to the alternatives. Details:
  [`API_NOTES.md` §6](API_NOTES.md#6-firmware-authorization-who-still-accepts-cloud-commands).
* **No live camera.** Remote camera streaming uses proprietary P2P SDKs that
  can't run in a browser. The app shows job thumbnails instead.
* **LAN-only printers** aren't reachable. This is a cloud web app.
* **Bot protection.** If Bambu's servers start blocking requests from Vercel's
  network, the app shows an "upstream blocked" error. Deploying in another
  region or on another provider may help.

## Project layout

```
app/                 Next.js App Router pages and API routes (all stateless)
  api/auth/*         login, email code, 2FA, logout, session
  api/printers       printer list
components/          client components (login form, printer list, spatial nav)
lib/bambu/           Bambu REST client, auth flow, model codes
lib/session.ts       encrypted httpOnly cookie
API_NOTES.md         research notes on Bambu's undocumented API
```

## License

MIT. See [`LICENSE`](LICENSE).
