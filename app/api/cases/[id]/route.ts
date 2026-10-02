import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { apiError, requireUserId } from "@/lib/api";
import { convexServer, serviceSecret } from "@/lib/convex-server";

const updateSchema = z.object({
  caseNumber: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().max(120).optional(),
  status: z.enum(["draft", "ready", "completed"]).optional(),
  specimen: z.string().max(10000).optional(),
  clinicalHistory: z.string().max(10000).optional(),
  grossDescription: z.string().max(20000).optional(),
  microscopicDescription: z.string().max(30000).optional(),
  diagnosis: z.string().max(20000).optional(),
  comment: z.string().max(20000).optional(),
  transcript: z.string().max(100000).optional(),
  report: z.string().max(100000).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const caseId = id as Id<"cases">;
    const [caseItem, assets] = await Promise.all([
      convexServer().query(api.cases.get, { secret: serviceSecret(), userId, caseId }),
      convexServer().query(api.assets.list, { secret: serviceSecret(), userId, caseId }),
    ]);
    return NextResponse.json({ case: caseItem, assets });
  } catch (error) {
    return apiError(error, "Could not load case");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const patch = updateSchema.parse(await request.json());
    await convexServer().mutation(api.cases.update, {
      secret: serviceSecret(),
      userId,
      caseId: id as Id<"cases">,
      ...patch,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Could not save case");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    await convexServer().mutation(api.cases.remove, {
      secret: serviceSecret(),
      userId,
      caseId: id as Id<"cases">,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Could not delete case");
  }
}
