import { auth } from "@/auth";
import { api } from "@/convex/_generated/api";
import { convexServer, serviceSecret } from "@/lib/convex-server";
import type { CaseRecord } from "@/lib/types";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cases" };

export default async function DashboardPage() {
  const session = await auth();
  const cases = session?.user?.id
    ? await convexServer().query(api.cases.list, { secret: serviceSecret(), userId: session.user.id })
    : [];
  return <DashboardClient initialCases={cases as CaseRecord[]} name={session?.user?.name || "Doctor"} />;
}
