import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, handleError, requireSession } from "@/lib/api";
import { fetchFeed, searchDesigns } from "@/lib/bambu/makerworld";
import { isNavKey } from "@/lib/makerworld";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * GET /api/makerworld?nav=Trending&offset=0
 * GET /api/makerworld?q=benchy&offset=0
 * Browsing MakerWorld needs no token, but we pass the session's when present.
 */
export async function GET(req: NextRequest) {
  const s = await requireSession();
  if (s instanceof NextResponse) return s;

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const nav = sp.get("nav") ?? "Trending";
  const offset = Number(sp.get("offset") ?? 0);
  const limit = Number(sp.get("limit") ?? 24);

  try {
    const feed = q
      ? await searchDesigns(s.r, q, offset, limit, s.t)
      : isNavKey(nav)
        ? await fetchFeed(s.r, nav, offset, limit, s.t)
        : null;
    if (!feed) return errorResponse("BAD_REQUEST", "Unknown category.", 400);
    return NextResponse.json(feed);
  } catch (e) {
    return handleError(e);
  }
}
