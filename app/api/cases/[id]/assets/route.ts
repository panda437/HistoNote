import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { apiError, requireUserId } from "@/lib/api";
import { convexServer, serviceSecret } from "@/lib/convex-server";

const schema = z.object({
  storageId: z.string().min(1),
  kind: z.enum(["audio", "image"]),
  filename: z.string().min(1).max(240),
  mimeType: z.string().max(120),
  size: z.number().int().nonnegative().max(250 * 1024 * 1024),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const assetId = await convexServer().mutation(api.assets.attach, {
      secret: serviceSecret(),
      userId,
      caseId: id as Id<"cases">,
      storageId: input.storageId as Id<"_storage">,
      kind: input.kind,
      filename: input.filename,
      mimeType: input.mimeType,
      size: input.size,
    });
    return NextResponse.json({ assetId }, { status: 201 });
  } catch (error) {
    return apiError(error, "Could not attach file");
  }
}
