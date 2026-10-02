import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { assertServiceSecret } from "./security";

async function assertCaseOwner(ctx: QueryCtx | MutationCtx, caseId: Id<"cases">, userId: string) {
  const item = await ctx.db.get(caseId);
  if (!item || item.userId !== userId) throw new Error("Case not found");
}

export const generateUploadUrl = mutation({
  args: { secret: v.string(), userId: v.string(), caseId: v.id("cases") },
  handler: async (ctx, args) => {
    assertServiceSecret(args.secret);
    await assertCaseOwner(ctx, args.caseId, args.userId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const attach = mutation({
  args: {
    secret: v.string(),
    userId: v.string(),
    caseId: v.id("cases"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("audio"), v.literal("image")),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    assertServiceSecret(args.secret);
    await assertCaseOwner(ctx, args.caseId, args.userId);
    return await ctx.db.insert("assets", {
      userId: args.userId,
      caseId: args.caseId,
      storageId: args.storageId,
      kind: args.kind,
      filename: args.filename,
      mimeType: args.mimeType,
      size: args.size,
      createdAt: Date.now(),
    });
  },
});

export const list = query({
  args: { secret: v.string(), userId: v.string(), caseId: v.id("cases") },
  handler: async (ctx, args) => {
    assertServiceSecret(args.secret);
    await assertCaseOwner(ctx, args.caseId, args.userId);
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
  args: { secret: v.string(), userId: v.string(), assetId: v.id("assets") },
  handler: async (ctx, args) => {
    assertServiceSecret(args.secret);
    const asset = await ctx.db.get(args.assetId);
    if (!asset || asset.userId !== args.userId) throw new Error("Asset not found");
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
