import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/dev-auth";
import { DevConsole } from "@/components/dev/DevConsole";

export const dynamic = "force-dynamic";

export default async function DevPage() {
  const owner = await requireOwner().catch(() => null);
  if (!owner) notFound();
  return <DevConsole />;
}
