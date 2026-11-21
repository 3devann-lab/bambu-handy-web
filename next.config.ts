import { randomBytes } from "node:crypto";
import type { NextConfig } from "next";

// Session cookies are encrypted with SESSION_SECRET when it's set. Otherwise
// we generate a random key once per build. It gets compiled into the
// server-only session module (lib/session.ts) and never reaches the browser
// bundle. The catch: each redeploy logs everyone out. See .env.example.
const buildSessionKey = randomBytes(32).toString("base64");

// Images come straight from Bambu / MakerWorld CDNs. Nothing else may load.
const IMAGE_HOSTS = [
  "https://makerworld.bblmw.com",
  "https://public-cdn.bblmw.com",
  "https://*.bblmw.com",
  "https://*.bambulab.com",
  "https://*.bambulab.cn",
  "https://*.aliyuncs.com",
  "https://*.amazonaws.com",
].join(" ");

const csp = [
  "default-src 'self'",
  // Next.js hydration needs inline bootstrap scripts. No third-party origins are allowed.
  // React's dev build needs eval for debugging; production never gets it.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${IMAGE_HOSTS}`,
  "font-src 'self'",
  // The browser only ever talks to this deployment. Bambu calls go through /api.
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    BHW_BUILD_SESSION_KEY: buildSessionKey,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
