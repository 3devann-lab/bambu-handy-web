import type { NextRequest } from "next/server";
import { errorResponse, handleError, readJson, regionOf, sameOrigin, str } from "@/lib/api";
import { loginWithCode } from "@/lib/bambu/auth";
import { finishLogin } from "@/lib/login";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return errorResponse("BAD_REQUEST", "Cross-origin request refused.", 403);
  const body = await readJson<{ account: string; code: string; region: string }>(req);
  const account = str(body.account);
  const code = str(body.code, 16).replace(/\s+/g, "");
  if (!account || !/^\d{4,8}$/.test(code)) return errorResponse("BAD_REQUEST", "Enter the code from the email.", 400);
  const region = regionOf(body.region);
  try {
    return await finishLogin(region, await loginWithCode(region, account, code));
  } catch (e) {
    return handleError(e);
  }
}
