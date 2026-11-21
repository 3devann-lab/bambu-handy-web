import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Region } from "./bambu/http";

/**
 * The whole "session store" is one encrypted, httpOnly cookie in the user's
 * own browser. The server keeps nothing: no database, no memory cache, no logs.
 *
 * - httpOnly: page JavaScript (including anything injected) can't read the token.
 * - Secure + SameSite=Strict: only sent over HTTPS, and only on same-site requests.
 * - AES-256-GCM: if the cookie leaks (e.g. a proxy log), it's useless without
 *   this deployment's key, and tampering is detected.
 */

export const SESSION_COOKIE = "bhw_session";
const MAX_AGE_S = 60 * 60 * 24 * 90; // Bambu tokens last ~90 days.

export interface Session {
  /** Bambu access token. */
  t: string;
  /** Numeric Bambu user id (MQTT username is `u_<uid>`). */
  u: string;
  r: Region;
  /** Display name, for the header. */
  n?: string;
  /** Expiry (unix seconds). */
  e: number;
}

function key(): Buffer {
  const secret = process.env.SESSION_SECRET || process.env.BHW_BUILD_SESSION_KEY;
  if (!secret) throw new Error("No session key available");
  return createHash("sha256").update(`bhw-session-v1:${secret}`).digest();
}

export function seal(session: Session): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${Buffer.concat([iv, tag, enc]).toString("base64url")}`;
}

export function unseal(value: string | undefined): Session | null {
  if (!value || !value.startsWith("v1.")) return null;
  try {
    const raw = Buffer.from(value.slice(3), "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    const s = JSON.parse(json) as Session;
    if (!s.t || !s.u || s.e * 1000 < Date.now()) return null;
    return s;
  } catch {
    // Wrong key (e.g. redeploy without SESSION_SECRET) or a tampered cookie.
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return unseal(jar.get(SESSION_COOKIE)?.value);
}

export async function setSession(session: Omit<Session, "e">, expiresInS?: number): Promise<void> {
  const maxAge = Math.min(expiresInS && expiresInS > 0 ? expiresInS : MAX_AGE_S, MAX_AGE_S);
  const full: Session = { ...session, e: Math.floor(Date.now() / 1000) + maxAge };
  const jar = await cookies();
  jar.set(SESSION_COOKIE, seal(full), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
