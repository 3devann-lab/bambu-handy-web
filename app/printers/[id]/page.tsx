import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import PrinterDetail from "@/components/PrinterDetail";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Live status" };

export default async function PrinterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9]{6,32}$/.test(id)) notFound();
  if (!(await getSession())) redirect(`/login?reason=login&next=/printers/${id}`);
  return <PrinterDetail id={id} />;
}
