import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { BambuError } from "./bambu/http";
import { clearSession, getSession, type Session } from "./session";

/** Uniform JSON error responses. Messages are user-facing and never include tokens. */
export function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function handleError(e: unknown) {
  if (e instanceof BambuError) {
    if (e.code === "AUTH_EXPIRED") await clearSession();
    return errorResponse(e.code, e.message, e.status);
  }
  // Deliberately log only the error class, never the payload or request.
  console.error("Unhandled API error:", e instanceof Error ? e.name : typeof e);
  return errorResponse("INTERNAL", "Something went wrong on our side.", 500);
}

/**
 * Light CSRF guard for state-changing routes. On top of the SameSite=Strict
 * cookie, require the Origin (when sent) to match the host we're serving.
 */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // Same-origin fetches from older browsers may omit it; SameSite still applies.
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function requireSession(): Promise<Session | NextResponse> {
  const s = await getSession();
  if (!s) return errorResponse("NOT_LOGGED_IN", "Please log in.", 401);
  return s;
}

export async function readJson<T>(req: NextRequest): Promise<Partial<T>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Partial<T>) : {};
  } catch {
    return {};
  }
}

export function str(v: unknown, max = 256): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function regionOf(v: unknown): "global" | "china" {
  return v === "china" ? "china" : "global";
}
