import "server-only";
import { NextResponse } from "next/server";
import { resolveUser, type LoginResult } from "./bambu/auth";
import type { Region } from "./bambu/http";
import { setSession } from "./session";

/**
 * Turn a Bambu login result into a response. A token goes straight into the
 * encrypted httpOnly cookie and never appears in the response body.
 */
export async function finishLogin(region: Region, result: LoginResult) {
  if (result.kind === "verifyCode") return NextResponse.json({ status: "verifyCode" });
  if (result.kind === "tfa") return NextResponse.json({ status: "tfa", tfaKey: result.tfaKey });

  const user = await resolveUser(region, result.token);
  await setSession({ t: result.token, u: user.uid, r: region, n: user.name }, result.expiresIn);
  return NextResponse.json({ status: "ok", name: user.name ?? null });
}
