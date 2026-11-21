import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; next?: string }>;
}) {
  const { reason, next } = await searchParams;
  if (await getSession()) redirect("/printers");
  return <LoginForm reason={reason} next={next} instanceNote={process.env.NEXT_PUBLIC_INSTANCE_NOTE || undefined} />;
}
