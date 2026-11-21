import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy & data flow" };

const REPO = "https://github.com/3devann-lab/bambu-handy-web";

export default function PrivacyPage() {
  return (
    <article className="stack" style={{ maxWidth: "75ch" }}>
      <h1>Privacy &amp; data flow</h1>
      <p>
        This site is a thin, <strong>stateless</strong> relay between your browser and Bambu Lab&apos;s servers.
        Browsers can&apos;t talk to Bambu directly (Bambu doesn&apos;t allow cross-origin requests), so a small amount
        of server code passes requests through. It has nowhere to keep your data, and it doesn&apos;t try to.
      </p>

      <section className="card stack">
        <h2>What happens when you log in</h2>
        <ol>
          <li>Your browser sends your email and password to this site&apos;s <code>/api/auth/login</code> over HTTPS.</li>
          <li>
            That function forwards them in a single request to <code>api.bambulab.com</code> (Bambu&apos;s official
            login endpoint), then forgets them when the function ends.
          </li>
          <li>
            Bambu replies with an access token, or asks for an email code or 2FA code. Those steps go straight to
            Bambu the same way.
          </li>
          <li>
            The token is encrypted (AES-256-GCM) and put in an <strong>httpOnly, Secure, SameSite=Strict</strong>{" "}
            cookie in <em>your</em> browser. Page scripts can&apos;t read it, and it&apos;s never sent to any other
            site.
          </li>
          <li>
            On later requests (printer list, status), the function decrypts the cookie, calls Bambu with the token, and
            returns the result. Printers&apos; LAN access codes are removed before anything reaches your browser.
          </li>
        </ol>
      </section>

      <section className="card stack">
        <h2>What is never stored or logged</h2>
        <ul>
          <li>No database, file storage, key-value store or cache of any kind.</li>
          <li>Your password exists only for the length of one request. The token lives only in your cookie.</li>
          <li>
            Tokens are only ever sent in HTTP headers, never in URLs, so they can&apos;t end up in hosting access logs.
            The code never logs request bodies or headers.
          </li>
          <li>
            No analytics, trackers, fonts, CDNs or other third-party scripts. A strict Content-Security-Policy
            blocks the browser from loading scripts from anywhere but this site.
          </li>
          <li>Logging out deletes the cookie. Since the server keeps nothing, that&apos;s all there is to delete.</li>
        </ul>
      </section>

      <section className="card stack">
        <h2>Who you&apos;re trusting</h2>
        <p>
          You&apos;re trusting whoever runs <em>this deployment</em> to run the published source unmodified.
          That&apos;s why the project is open source and has a one-click &ldquo;Deploy your own&rdquo; button: the
          safest setup is your own copy on your own free Vercel account.
        </p>
        <p>
          Check the claims yourself: start with <code>lib/session.ts</code> (cookie), <code>lib/bambu/http.ts</code>{" "}
          (every upstream call), <code>app/api/</code> (all server routes) and <code>next.config.ts</code> (security
          headers) in the <a href={REPO}>source repository</a>.
        </p>
      </section>

      <section className="card stack" id="firmware">
        <h2>Live status and firmware limits</h2>
        <p>
          Live status uses Bambu&apos;s cloud MQTT service. For each update, the server opens a short connection
          with your token, listens for a few seconds, and disconnects. The browser keeps the latest state. Nothing
          is cached on the server.
        </p>
        <p>
          Since 2025, Bambu firmware requires print commands (start, pause, stop) to be signed by Bambu&apos;s own
          apps. Reading status is still open to everyone. This project won&apos;t extract or imitate Bambu&apos;s
          signing keys, so on printers with that check enabled it only monitors. Details are in{" "}
          <a href={`${REPO}/blob/main/API_NOTES.md#6-firmware-authorization-who-still-accepts-cloud-commands`}>
            API_NOTES.md
          </a>
          .
        </p>
      </section>

      <section className="alert warn">
        <h2>Unofficial software</h2>
        <p>
          This project is not affiliated with, endorsed by, or supported by Bambu Lab. It uses undocumented APIs that
          may change or stop working at any time. Use it at your own risk.
        </p>
      </section>
    </article>
  );
}
