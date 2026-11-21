import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, handleError, readJson, regionOf, sameOrigin, str } from "@/lib/api";
import { sendLoginCode } from "@/lib/bambu/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return errorResponse("BAD_REQUEST", "Cross-origin request refused.", 403);
  const body = await readJson<{ account: string; region: string }>(req);
  const account = str(body.account);
  if (!account) return errorResponse("BAD_REQUEST", "Enter your email first.", 400);
  try {
    await sendLoginCode(regionOf(body.region), account);
    return NextResponse.json({ status: "sent" });
  } catch (e) {
    return handleError(e);
  }
}
