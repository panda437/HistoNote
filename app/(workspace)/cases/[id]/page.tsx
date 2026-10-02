import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexServer, serviceSecret } from "@/lib/convex-server";
import type { CaseAsset, CaseRecord } from "@/lib/types";
import { CaseWorkspace } from "./CaseWorkspace";

export const dynamic = "force-dynamic";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;
  if (!session?.user?.id) notFound();
  let caseItem;
  let assets;
  try {
    const caseId = id as Id<"cases">;
    [caseItem, assets] = await Promise.all([
      convexServer().query(api.cases.get, { secret: serviceSecret(), userId: session.user.id, caseId }),
      convexServer().query(api.assets.list, { secret: serviceSecret(), userId: session.user.id, caseId }),
    ]);
  } catch {
    notFound();
  }
  return <CaseWorkspace initialCase={caseItem as CaseRecord} initialAssets={assets as CaseAsset[]} />;
}
