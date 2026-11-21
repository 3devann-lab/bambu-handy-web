import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PrinterList from "@/components/PrinterList";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Printers" };

export default async function PrintersPage() {
  if (!(await getSession())) redirect("/login?reason=login&next=/printers");
  return <PrinterList />;
}
