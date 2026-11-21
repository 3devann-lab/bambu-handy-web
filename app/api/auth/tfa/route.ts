import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, handleError, readJson, regionOf, sameOrigin, str } from "@/lib/api";
import { TfaCsrfError, loginWithTfa, sendLoginCode } from "@/lib/bambu/auth";
import { finishLogin } from "@/lib/login";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return errorResponse("BAD_REQUEST", "Cross-origin request refused.", 403);
  const body = await readJson<{ account: string; tfaKey: string; tfaCode: string; region: string }>(req);
  const tfaKey = str(body.tfaKey, 2048);
  const tfaCode = str(body.tfaCode, 16).replace(/\s+/g, "");
  const account = str(body.account);
  if (!tfaKey || !/^\d{6}$/.test(tfaCode)) {
    return errorResponse("BAD_REQUEST", "Enter the 6-digit code from your authenticator app.", 400);
  }
  const region = regionOf(body.region);
  try {
    return await finishLogin(region, await loginWithTfa(region, tfaKey, tfaCode));
  } catch (e) {
    if (e instanceof TfaCsrfError) {
      // Bambu's website-side 2FA endpoint is refusing us. Fall back to an emailed code.
      if (account) {
        try {
          await sendLoginCode(region, account);
          return NextResponse.json({ status: "verifyCode", fallback: true });
        } catch (inner) {
          return handleError(inner);
        }
      }
      return errorResponse("UPSTREAM_ERROR", "Bambu's 2FA service is unavailable. Try logging in again.", 502);
    }
    return handleError(e);
  }
}
