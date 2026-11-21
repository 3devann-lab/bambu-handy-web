import { NextResponse } from "next/server";
import { handleError, requireSession } from "@/lib/api";
import { listPrinters } from "@/lib/bambu/devices";

export const runtime = "nodejs";

export async function GET() {
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  try {
    return NextResponse.json({ printers: await listPrinters(s.r, s.t) });
  } catch (e) {
    return handleError(e);
  }
}
