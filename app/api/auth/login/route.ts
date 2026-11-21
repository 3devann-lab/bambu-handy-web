import type { NextRequest } from "next/server";
import { errorResponse, handleError, readJson, regionOf, sameOrigin, str } from "@/lib/api";
import { loginWithPassword } from "@/lib/bambu/auth";
import { finishLogin } from "@/lib/login";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return errorResponse("BAD_REQUEST", "Cross-origin request refused.", 403);
  const body = await readJson<{ account: string; password: string; region: string }>(req);
  const account = str(body.account);
  const password = typeof body.password === "string" ? body.password.slice(0, 512) : "";
  if (!account || !password) return errorResponse("BAD_REQUEST", "Enter your email (or phone) and password.", 400);
  const region = regionOf(body.region);
  try {
    return await finishLogin(region, await loginWithPassword(region, account, password));
  } catch (e) {
    return handleError(e);
  }
}
