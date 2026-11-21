"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

export default function SiteHeader({ loggedIn, name }: { loggedIn: boolean; name?: string }) {
  const path = usePathname();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => null);
    window.location.assign("/login?reason=loggedout");
  }

  const link = (href: string, label: string) => (
    <a href={href} aria-current={path === href || path.startsWith(href + "/") ? "page" : undefined}>
      {label}
    </a>
  );

  return (
    <header className="site-header">
      <a className="brand" href={loggedIn ? "/printers" : "/login"}>
        <span className="brand-mark" aria-hidden="true" />
        Bambu Web Remote <small>unofficial</small>
      </a>
      <nav className="nav" aria-label="Main">
        {loggedIn && link("/printers", "Printers")}
        {link("/privacy", "Privacy")}
        {loggedIn ? (
          <button type="button" onClick={logout} disabled={busy} title={name ? `Signed in as ${name}` : undefined}>
            {busy ? "Logging out…" : "Log out"}
          </button>
        ) : (
          link("/login", "Log in")
        )}
      </nav>
    </header>
  );
}
