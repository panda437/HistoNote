import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { apiError, requireUserId } from "@/lib/api";
import { convexServer, serviceSecret } from "@/lib/convex-server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const uploadUrl = await convexServer().mutation(api.assets.generateUploadUrl, {
      secret: serviceSecret(),
      userId,
      caseId: id as Id<"cases">,
    });
    return NextResponse.json({ uploadUrl });
  } catch (error) {
    return apiError(error, "Could not prepare upload");
  }
}
