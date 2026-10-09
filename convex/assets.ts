import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireSession } from "./security";

async function assertCaseOwner(ctx: QueryCtx | MutationCtx, caseId: Id<"cases">, userId: string) {
  const item = await ctx.db.get(caseId);
  if (!item || item.userId !== userId) throw new Error("Case not found");
}

export const generateUploadUrl = mutation({
  args: { sessionToken: v.string(), caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const user = await requireSession(ctx, args.sessionToken);
    await assertCaseOwner(ctx, args.caseId, user._id);
    return await ctx.storage.generateUploadUrl();
  },
});

export const attach = mutation({
  args: {
    sessionToken: v.string(),
    caseId: v.id("cases"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("audio"), v.literal("image")),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    recordedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireSession(ctx, args.sessionToken);
    await assertCaseOwner(ctx, args.caseId, user._id);
    return await ctx.db.insert("assets", {
      userId: user._id,
      caseId: args.caseId,
      storageId: args.storageId,
      kind: args.kind,
      filename: args.filename,
      mimeType: args.mimeType,
      size: args.size,
      recordedAt: args.recordedAt,
      durationMs: args.durationMs,
      createdAt: Date.now(),
    });
  },
});

export const list = query({
  args: { sessionToken: v.string(), caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const user = await requireSession(ctx, args.sessionToken);
    await assertCaseOwner(ctx, args.caseId, user._id);
    const rows = await ctx.db
      .query("assets")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .collect();
    return await Promise.all(rows.map(async (asset) => ({
      ...asset,
      url: await ctx.storage.getUrl(asset.storageId),
    })));
  },
});

export const remove = mutation({
  args: { sessionToken: v.string(), assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const user = await requireSession(ctx, args.sessionToken);
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.userId !== user._id) throw new Error("Asset not found");
    await ctx.storage.delete(asset.storageId);
    await ctx.db.delete(asset._id);
  },
});

export const getForProcessing = internalQuery({
  args: { userId: v.string(), assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.userId !== args.userId || asset.kind !== "audio") {
      throw new Error("Audio recording not found");
    }
    return asset;
  },
});

export const saveTranscription = internalMutation({
  args: {
    userId: v.string(),
    assetId: v.id("assets"),
    transcript: v.string(),
    transcriptSegments: v.array(v.object({
      startMs: v.number(),
      endMs: v.number(),
      text: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.userId !== args.userId || asset.kind !== "audio") {
      throw new Error("Audio recording not found");
    }
    await ctx.db.patch(args.assetId, {
      transcript: args.transcript,
      transcriptSegments: args.transcriptSegments,
      processingError: "",
    });
  },
});

export const saveProcessingFailure = internalMutation({
  args: {
    userId: v.string(),
    assetId: v.id("assets"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.userId !== args.userId || asset.kind !== "audio") return;
    await ctx.db.patch(args.assetId, { processingError: args.message });
  },
});
