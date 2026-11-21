"use client";

/** Browser-side helper for calling this app's own /api routes. */

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("NETWORK", "You appear to be offline.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } };
  if (!res.ok) {
    const err = new ApiError(data.error?.code ?? "UNKNOWN", data.error?.message ?? `Request failed (${res.status})`, res.status);
    if (err.code === "AUTH_EXPIRED" || err.code === "NOT_LOGGED_IN") {
      const reason = err.code === "AUTH_EXPIRED" ? "expired" : "login";
      window.location.assign(`/login?reason=${reason}&next=${encodeURIComponent(location.pathname)}`);
    }
    throw err;
  }
  return data as T;
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return "–";
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
