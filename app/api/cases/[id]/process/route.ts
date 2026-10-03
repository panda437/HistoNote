import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireUserId } from "@/lib/api";
import { convexServer, serviceSecret } from "@/lib/convex-server";

const schema = z.object({
  assetId: z.string().optional(),
  transcript: z.string().max(100000).optional(),
}).refine((value) => value.assetId || value.transcript?.trim(), {
  message: "A recording or transcript is required",
});

export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const result = await convexServer().action(api.processing.run, {
      secret: serviceSecret(),
      userId,
      caseId: id as Id<"cases">,
      assetId: input.assetId as Id<"assets"> | undefined,
      transcript: input.transcript,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Dictation processing failed", error);
    return NextResponse.json({
      error: "Processing could not finish. Your uploaded recording and existing case data are still safe; please retry.",
    }, { status: 500 });
  }
}
