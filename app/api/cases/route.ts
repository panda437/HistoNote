import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { apiError, requireUserId } from "@/lib/api";
import { convexServer, serviceSecret } from "@/lib/convex-server";

const createSchema = z.object({
  caseNumber: z.string().trim().min(1).max(80),
  title: z.string().trim().max(120).default(""),
  reportType: z.enum(["gi_biopsy", "breast_core"]),
});

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const cases = await convexServer().query(api.cases.list, { secret: serviceSecret(), userId });
    return NextResponse.json({ cases });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = createSchema.parse(await request.json());
    const id = await convexServer().mutation(api.cases.create, {
      secret: serviceSecret(),
      userId,
      ...input,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return apiError(error, "Could not create case");
  }
}
