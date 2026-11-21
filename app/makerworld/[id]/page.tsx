import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import DesignDetail from "@/components/DesignDetail";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Design" };

export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) notFound();
  if (!(await getSession())) redirect(`/login?reason=login&next=/makerworld/${id}`);
  return <DesignDetail id={Number(id)} />;
}
