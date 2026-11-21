import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, handleError, requireSession } from "@/lib/api";
import { fetchDesign } from "@/lib/bambu/makerworld";

export const runtime = "nodejs";
export const maxDuration = 20;

/** GET /api/makerworld/:id → full design detail with print profiles. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const { id } = await ctx.params;
  const designId = Number(id);
  if (!Number.isInteger(designId) || designId <= 0) return errorResponse("BAD_REQUEST", "Invalid design id.", 400);
  try {
    const design = await fetchDesign(s.r, designId, s.t);
    if (!design) return errorResponse("NOT_FOUND", "That design wasn't found on MakerWorld.", 404);
    return NextResponse.json({ design });
  } catch (e) {
    return handleError(e);
  }
}
