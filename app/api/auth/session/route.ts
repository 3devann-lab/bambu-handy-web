import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import type { SessionInfo } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const s = await getSession();
  const body: SessionInfo = s ? { loggedIn: true, name: s.n, region: s.r } : { loggedIn: false };
  return NextResponse.json(body);
}
