import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, handleError, requireSession } from "@/lib/api";
import { collectReports } from "@/lib/bambu/mqtt";

export const runtime = "nodejs";
// Each poll holds an MQTT connection for a few seconds at most.
export const maxDuration = 20;

const DEVICE_ID = /^[A-Za-z0-9]{6,32}$/;

/**
 * GET /api/printers/:id/status?full=1
 *  full=1 → send `pushall` and wait (up to ~8 s) for a complete snapshot.
 *  full=0 → just listen ~3 s for delta reports; the browser merges them.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const { id } = await ctx.params;
  if (!DEVICE_ID.test(id)) return errorResponse("BAD_REQUEST", "Invalid printer id.", 400);
  const full = req.nextUrl.searchParams.get("full") === "1";

  try {
    const result = await collectReports({
      region: s.r,
      token: s.t,
      uid: s.u,
      deviceId: id,
      full,
      windowMs: full ? 8_000 : 3_000,
    });
    return NextResponse.json({ print: result.print, messages: result.messages, full, at: Date.now() });
  } catch (e) {
    return handleError(e);
  }
}
