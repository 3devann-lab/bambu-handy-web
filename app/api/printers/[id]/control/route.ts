import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, handleError, readJson, requireSession, sameOrigin } from "@/lib/api";
import { sendControl, sendLight, sendSpeed } from "@/lib/bambu/print";

export const runtime = "nodejs";
export const maxDuration = 20;

const DEVICE_ID = /^[A-Za-z0-9]{6,32}$/;

interface Body {
  action: "pause" | "resume" | "stop" | "speed" | "light";
  level?: number;
  on?: boolean;
}

/**
 * POST /api/printers/:id/control
 * Pause / resume / stop / speed / chamber light. Every command is unsigned,
 * so the handler reads the firmware's authorization flags first and refuses
 * (409 FIRMWARE_BLOCKED) when the printer only accepts signed commands.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return errorResponse("BAD_REQUEST", "Cross-origin request refused.", 403);
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const { id } = await ctx.params;
  if (!DEVICE_ID.test(id)) return errorResponse("BAD_REQUEST", "Invalid printer id.", 400);

  const body = await readJson<Body>(req);
  const action = body.action;

  try {
    switch (action) {
      case "pause":
      case "resume":
      case "stop":
        return NextResponse.json(await sendControl(s.r, s.t, s.u, id, action));
      case "speed": {
        const level = Number(body.level);
        if (!Number.isInteger(level) || level < 1 || level > 4) {
          return errorResponse("BAD_REQUEST", "Speed must be 1–4.", 400);
        }
        return NextResponse.json(await sendSpeed(s.r, s.t, s.u, id, level));
      }
      case "light":
        return NextResponse.json(await sendLight(s.r, s.t, s.u, id, body.on === true));
      default:
        return errorResponse("BAD_REQUEST", "Unknown control action.", 400);
    }
  } catch (e) {
    return handleError(e);
  }
}
