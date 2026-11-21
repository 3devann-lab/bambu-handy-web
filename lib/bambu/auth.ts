import "server-only";
import { BambuError, WEB_HOST, bambuFetch, readSetCookie, upstreamMessage, type Region } from "./http";

/** See API_NOTES.md §2. */

export type LoginResult =
  | { kind: "token"; token: string; expiresIn?: number }
  | { kind: "verifyCode" }
  | { kind: "tfa"; tfaKey: string };

interface LoginResponse {
  accessToken?: string;
  expiresIn?: number;
  loginType?: string;
  tfaKey?: string;
  code?: number | null;
  error?: string | null;
  message?: string;
}

export async function loginWithPassword(region: Region, account: string, password: string): Promise<LoginResult> {
  const { status, data } = await bambuFetch<LoginResponse>("/v1/user-service/user/login", {
    region,
    method: "POST",
    body: { account, password, apiError: "" },
    allowClientErrors: true,
  });

  if (data.accessToken) return { kind: "token", token: data.accessToken, expiresIn: data.expiresIn };
  if (data.loginType === "verifyCode") return { kind: "verifyCode" };
  if (data.loginType === "tfa" && data.tfaKey) return { kind: "tfa", tfaKey: data.tfaKey };

  if (status === 400 || status === 403) {
    throw new BambuError("BAD_CREDENTIALS", upstreamMessage(data) ?? "Incorrect account or password.", 400);
  }
  throw new BambuError("UPSTREAM_ERROR", "Bambu's login service returned a response we didn't understand.", 502);
}

export async function loginWithCode(region: Region, account: string, code: string): Promise<LoginResult> {
  const { status, data } = await bambuFetch<LoginResponse>("/v1/user-service/user/login", {
    region,
    method: "POST",
    body: { account, code },
    allowClientErrors: true,
  });
  if (data.accessToken) return { kind: "token", token: data.accessToken, expiresIn: data.expiresIn };
  if (status === 400 && data.code === 1) {
    throw new BambuError("CODE_EXPIRED", "That code has expired. Request a new one.", 400);
  }
  if (status === 400 && data.code === 2) {
    throw new BambuError("CODE_INCORRECT", "That code is incorrect. Check the email and try again.", 400);
  }
  throw new BambuError("BAD_CREDENTIALS", upstreamMessage(data) ?? "Code login failed.", 400);
}

export async function sendLoginCode(region: Region, account: string): Promise<void> {
  if (account.includes("@")) {
    await bambuFetch("/v1/user-service/user/sendemail/code", {
      region,
      method: "POST",
      body: { email: account, type: "codeLogin" },
    });
    return;
  }
  // SMS codes are only reported to work for China-region phone accounts.
  await bambuFetch("/api/v1/user-service/user/sendsmscode", {
    region,
    method: "POST",
    absoluteUrl: `${WEB_HOST.china}/api/v1/user-service/user/sendsmscode`,
    body: { phone: account, type: "codeLogin" },
  });
}

export class TfaCsrfError extends Error {}

/**
 * The 2FA leg lives on the website host and needs a CSRF cookie first.
 * It has broken before. Callers should catch TfaCsrfError and fall back
 * to email-code login, as ha-bambulab does.
 */
export async function loginWithTfa(region: Region, tfaKey: string, tfaCode: string): Promise<LoginResult> {
  let csrf: string | undefined;
  try {
    const res = await bambuFetch("/api/csrf", {
      region,
      absoluteUrl: `${WEB_HOST[region]}/api/csrf`,
      allowClientErrors: true,
    });
    csrf = readSetCookie(res.headers, "bbl_csrf_token");
  } catch (e) {
    if (e instanceof BambuError && e.code === "NETWORK") throw e;
    throw new TfaCsrfError();
  }
  if (!csrf) throw new TfaCsrfError();

  const res = await bambuFetch<Record<string, unknown>>("/api/sign-in/tfa", {
    region,
    method: "POST",
    absoluteUrl: `${WEB_HOST[region]}/api/sign-in/tfa`,
    body: { tfaKey, tfaCode },
    headers: { "x-bbl-csrf-token": csrf, Cookie: `bbl_csrf_token=${csrf}` },
    allowClientErrors: true,
  });

  if (res.status === 403 && JSON.stringify(res.data).includes("missing_cookie")) throw new TfaCsrfError();
  if (res.status === 400) {
    throw new BambuError("CODE_INCORRECT", "That authenticator code is incorrect.", 400);
  }
  const token = readSetCookie(res.headers, "token");
  if (!token) throw new BambuError("UPSTREAM_ERROR", "2FA login succeeded but no token was returned.", 502);
  return { kind: "token", token };
}

/** Resolve the numeric user id: JWT payload first, then the preference endpoint. */
export async function resolveUser(region: Region, token: string): Promise<{ uid: string; name?: string }> {
  const parts = token.split(".");
  let uid: string | undefined;
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { username?: string };
      if (payload.username?.startsWith("u_")) uid = payload.username.slice(2);
    } catch {
      /* not a JWT we understand */
    }
  }
  const { data } = await bambuFetch<{ uid?: number | string; name?: string; handle?: string }>(
    "/v1/design-user-service/my/preference",
    { region, token },
  );
  uid = uid ?? (data.uid != null ? String(data.uid) : undefined);
  if (!uid) throw new BambuError("UPSTREAM_ERROR", "Couldn't determine your Bambu user id.", 502);
  return { uid, name: data.name || data.handle };
}
