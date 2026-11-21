import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, handleError, readJson, requireSession, sameOrigin } from "@/lib/api";
import { preflight, startPrint } from "@/lib/bambu/print";

export const runtime = "nodejs";
export const maxDuration = 25;

const DEVICE_ID = /^[A-Za-z0-9]{6,32}$/;

/** GET /api/printers/:id/print → firmware pre-flight (can this printer accept an unsigned print?). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const { id } = await ctx.params;
  if (!DEVICE_ID.test(id)) return errorResponse("BAD_REQUEST", "Invalid printer id.", 400);
  try {
    const pf = await preflight(s.r, s.t, s.u, id);
    return NextResponse.json({
      control: pf.control,
      reportSeen: pf.reportSeen,
      state: pf.status?.state ?? null,
      ams: pf.status?.ams ?? [],
      externalSpool: pf.status?.externalSpool ?? null,
    });
  } catch (e) {
    return handleError(e);
  }
}

interface PrintBody {
  modelId: string;
  profileId: number;
  plateIndex: number;
  title: string;
  cover: string;
  mapping: number[];
}

/**
 * POST /api/printers/:id/print
 * Start a MakerWorld pre-sliced profile. Refuses (409 FIRMWARE_BLOCKED) on
 * firmware with authorization control — this app never signs commands.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return errorResponse("BAD_REQUEST", "Cross-origin request refused.", 403);
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const { id } = await ctx.params;
  if (!DEVICE_ID.test(id)) return errorResponse("BAD_REQUEST", "Invalid printer id.", 400);

  const body = await readJson<PrintBody>(req);
  const modelId = typeof body.modelId === "string" ? body.modelId.slice(0, 64) : "";
  const profileId = Number(body.profileId);
  const plateIndex = Number(body.plateIndex);
  const title = (typeof body.title === "string" ? body.title : "Print").slice(0, 120);
  const cover = typeof body.cover === "string" ? body.cover.slice(0, 512) : "";
  const mapping = Array.isArray(body.mapping)
    ? body.mapping.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n))
    : [];

  if (!modelId || !Number.isInteger(profileId) || profileId <= 0) {
    return errorResponse("BAD_REQUEST", "Missing or invalid MakerWorld profile.", 400);
  }
  if (!Number.isInteger(plateIndex) || plateIndex < 1) {
    return errorResponse("BAD_REQUEST", "Invalid plate.", 400);
  }
  if (mapping.length === 0) {
    return errorResponse("BAD_REQUEST", "No filament mapping was provided.", 400);
  }

  try {
    const result = await startPrint(s.r, s.t, s.u, {
      deviceId: id,
      modelId,
      profileId,
      plateIndex,
      title,
      cover,
      mapping,
    });
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
