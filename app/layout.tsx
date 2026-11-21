import type { Metadata, Viewport } from "next";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import SpatialNav from "@/components/SpatialNav";
import Disclaimer from "@/components/Disclaimer";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: { default: "Bambu Web Remote (unofficial)", template: "%s · Bambu Web Remote" },
  description:
    "Unofficial, open-source web client for Bambu Lab printers. Not affiliated with or endorsed by Bambu Lab.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#121417",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteHeader loggedIn={Boolean(session)} name={session?.n} />
        <main id="main">{children}</main>
        <footer className="site-footer">
          <p>
            <strong>Unofficial.</strong> Bambu Web Remote is an independent open-source project. It is not affiliated
            with, endorsed by, or supported by Bambu Lab. &ldquo;Bambu Lab&rdquo;, &ldquo;Bambu Handy&rdquo; and
            &ldquo;MakerWorld&rdquo; are trademarks of their respective owners.
          </p>
          <p>
            No database, no analytics, no third-party scripts. Your credentials go straight to Bambu.{" "}
            <a href="/privacy">How your data flows</a>.
          </p>
        </footer>
        <SpatialNav />
        <Disclaimer />
      </body>
    </html>
  );
}
