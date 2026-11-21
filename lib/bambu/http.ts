import "server-only";

/**
 * Thin, stateless wrapper around Bambu's REST API.
 *
 * Privacy rules enforced here (and checked in review):
 *  - Nothing in this file logs request or response bodies, headers or tokens.
 *  - Tokens only travel in the Authorization header, never in a URL, because
 *    URLs end up in hosting access logs.
 */

export type Region = "global" | "china";

export const API_HOST: Record<Region, string> = {
  global: "https://api.bambulab.com",
  china: "https://api.bambulab.cn",
};

export const WEB_HOST: Record<Region, string> = {
  global: "https://bambulab.com",
  china: "https://bambulab.cn",
};

export const MQTT_HOST: Record<Region, string> = {
  global: "us.mqtt.bambulab.com",
  china: "cn.mqtt.bambulab.com",
};

export type ErrorCode =
  | "NOT_LOGGED_IN"
  | "AUTH_EXPIRED"
  | "BAD_CREDENTIALS"
  | "CODE_INCORRECT"
  | "CODE_EXPIRED"
  | "UPSTREAM_BLOCKED"
  | "UPSTREAM_ERROR"
  | "NETWORK"
  | "BAD_REQUEST"
  | "PRINTER_OFFLINE"
  | "FIRMWARE_BLOCKED"
  | "AMS_MISMATCH"
  | "NOT_FOUND";

export class BambuError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 502,
  ) {
    super(message);
    this.name = "BambuError";
  }
}

const APP_VERSION = "00.01.00.00";

/** We identify honestly as an open-source third-party client. */
export function baseHeaders(): Record<string, string> {
  return {
    "User-Agent": `bambu-handy-web/${APP_VERSION} (+open source; unofficial)`,
    "X-BBL-Client-Name": "bambu-handy-web",
    "X-BBL-Client-Type": "web",
    "X-BBL-Client-Version": APP_VERSION,
    "X-BBL-Language": "en-US",
    Accept: "application/json",
  };
}

export interface BambuFetchOptions {
  region: Region;
  token?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Return 4xx JSON bodies to the caller instead of throwing (login uses this). */
  allowClientErrors?: boolean;
  headers?: Record<string, string>;
  /** Absolute URL instead of the regional API host (used for the website 2FA leg). */
  absoluteUrl?: string;
  timeoutMs?: number;
}

export interface BambuResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

function looksLikeCloudflare(status: number, text: string): boolean {
  if (status !== 403 && status !== 429 && status !== 503) return false;
  const t = text.slice(0, 2000).toLowerCase();
  return t.includes("cloudflare") || t.includes("just a moment") || t.includes("cf-chl");
}

export async function bambuFetch<T = Record<string, unknown>>(
  path: string,
  opts: BambuFetchOptions,
): Promise<BambuResponse<T>> {
  const url = opts.absoluteUrl ?? API_HOST[opts.region] + path;
  const headers: Record<string, string> = { ...baseHeaders(), ...opts.headers };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
    });
  } catch {
    throw new BambuError("NETWORK", "Couldn't reach Bambu's servers. Try again in a moment.", 504);
  }

  const text = await res.text();

  if (looksLikeCloudflare(res.status, text)) {
    throw new BambuError(
      "UPSTREAM_BLOCKED",
      "Bambu's servers refused requests from this deployment (bot protection). Try again later, or self-host on another provider/region.",
      502,
    );
  }

  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (res.ok) throw new BambuError("UPSTREAM_ERROR", "Bambu returned an unexpected response.", 502);
      data = {};
    }
  }

  if (res.status === 401) {
    throw new BambuError("AUTH_EXPIRED", "Your Bambu session has expired. Please log in again.", 401);
  }

  if (res.status >= 400 && !(opts.allowClientErrors && res.status < 500)) {
    const msg = upstreamMessage(data) ?? `Bambu returned HTTP ${res.status}.`;
    const code: ErrorCode = res.status === 404 ? "NOT_FOUND" : res.status < 500 ? "BAD_REQUEST" : "UPSTREAM_ERROR";
    throw new BambuError(code, msg, res.status === 404 ? 404 : 502);
  }

  return { status: res.status, data: data as T, headers: res.headers };
}

export function upstreamMessage(data: unknown): string | undefined {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const k of ["error", "message"]) {
      const v = d[k];
      if (typeof v === "string" && v && v.toLowerCase() !== "success") return v;
    }
  }
  return undefined;
}

/** Read a cookie value from a fetch response's Set-Cookie headers. */
export function readSetCookie(headers: Headers, name: string): string | undefined {
  const all: string[] =
    typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  for (const c of all) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0 && pair.slice(0, idx).trim() === name) return decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return undefined;
}
