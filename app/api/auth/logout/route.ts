import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, sameOrigin } from "@/lib/api";
import { clearSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return errorResponse("BAD_REQUEST", "Cross-origin request refused.", 403);
  // The server holds no state, so deleting the cookie is the whole logout.
  await clearSession();
  return NextResponse.json({ status: "ok" });
}
