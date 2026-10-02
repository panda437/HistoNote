import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertServiceSecret } from "./security";

const reportType = v.union(v.literal("gi_biopsy"), v.literal("breast_core"));
const status = v.union(v.literal("draft"), v.literal("ready"), v.literal("completed"));

async function ownedCase(ctx: QueryCtx | MutationCtx, caseId: Id<"cases">, userId: string): Promise<Doc<"cases">> {
  const item = await ctx.db.get(caseId);
  if (!item || item.userId !== userId) throw new Error("Case not found");
  return item;
}

export const list = query({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    assertServiceSecret(args.secret);
    return await ctx.db
      .query("cases")
      .withIndex("by_user_updated", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { secret: v.string(), userId: v.string(), caseId: v.id("cases") },
  handler: async (ctx, args) => {
    assertServiceSecret(args.secret);
    return await ownedCase(ctx, args.caseId, args.userId);
  },
});

export const create = mutation({
  args: {
    secret: v.string(),
    userId: v.string(),
    caseNumber: v.string(),
    title: v.string(),
    reportType,
  },
  handler: async (ctx, args) => {
    assertServiceSecret(args.secret);
    const now = Date.now();
    return await ctx.db.insert("cases", {
      userId: args.userId,
      caseNumber: args.caseNumber.trim(),
      title: args.title.trim() || "Untitled case",
      reportType: args.reportType,
      status: "draft",
      specimen: "",
      clinicalHistory: "",
      grossDescription: "",
      microscopicDescription: "",
      diagnosis: "",
      comment: "",
      transcript: "",
      report: "",
      evidence: [],
      uncertainties: [],
      missingFields: ["Specimen", "Clinical history", "Microscopic description", "Diagnosis"],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    secret: v.string(),
    userId: v.string(),
    caseId: v.id("cases"),
    caseNumber: v.optional(v.string()),
    title: v.optional(v.string()),
    status: v.optional(status),
    specimen: v.optional(v.string()),
    clinicalHistory: v.optional(v.string()),
    grossDescription: v.optional(v.string()),
    microscopicDescription: v.optional(v.string()),
    diagnosis: v.optional(v.string()),
    comment: v.optional(v.string()),
    transcript: v.optional(v.string()),
    report: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertServiceSecret(args.secret);
    await ownedCase(ctx, args.caseId, args.userId);
    await ctx.db.patch(args.caseId, {
      caseNumber: args.caseNumber,
      title: args.title,
      status: args.status,
      specimen: args.specimen,
      clinicalHistory: args.clinicalHistory,
      grossDescription: args.grossDescription,
      microscopicDescription: args.microscopicDescription,
      diagnosis: args.diagnosis,
      comment: args.comment,
      transcript: args.transcript,
      report: args.report,
      updatedAt: Date.now(),
    });
    return args.caseId;
  },
});

export const remove = mutation({
  args: { secret: v.string(), userId: v.string(), caseId: v.id("cases") },
  handler: async (ctx, args) => {
    assertServiceSecret(args.secret);
    await ownedCase(ctx, args.caseId, args.userId);
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();
    for (const asset of assets) {
      await ctx.storage.delete(asset.storageId);
      await ctx.db.delete(asset._id);
    }
    await ctx.db.delete(args.caseId);
  },
});

export const getForProcessing = internalQuery({
  args: { userId: v.string(), caseId: v.id("cases") },
  handler: async (ctx, args) => await ownedCase(ctx, args.caseId, args.userId),
});

export const saveProcessed = internalMutation({
  args: {
    userId: v.string(),
    caseId: v.id("cases"),
    transcript: v.string(),
    specimen: v.string(),
    clinicalHistory: v.string(),
    grossDescription: v.string(),
    microscopicDescription: v.string(),
    diagnosis: v.string(),
    comment: v.string(),
    report: v.string(),
    evidence: v.array(v.object({
      field: v.string(),
      sourceQuote: v.string(),
      confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    })),
    uncertainties: v.array(v.object({
      field: v.string(),
      issue: v.string(),
      sourceQuote: v.string(),
    })),
    missingFields: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ownedCase(ctx, args.caseId, args.userId);
    await ctx.db.patch(args.caseId, {
      transcript: args.transcript,
      specimen: args.specimen,
      clinicalHistory: args.clinicalHistory,
      grossDescription: args.grossDescription,
      microscopicDescription: args.microscopicDescription,
      diagnosis: args.diagnosis,
      comment: args.comment,
      report: args.report,
      evidence: args.evidence,
      uncertainties: args.uncertainties,
      missingFields: args.missingFields,
      status: args.missingFields.length ? "draft" : "ready",
      updatedAt: Date.now(),
    });
  },
});
