import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MakerWorldBrowser from "@/components/MakerWorldBrowser";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "MakerWorld" };

export default async function MakerWorldPage() {
  if (!(await getSession())) redirect("/login?reason=login&next=/makerworld");
  return <MakerWorldBrowser />;
}
