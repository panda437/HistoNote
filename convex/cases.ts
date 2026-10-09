import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireSession } from "./security";

const reportType = v.union(
  v.literal("gi_biopsy"),
  v.literal("breast_core"),
  v.literal("breast_excision"),
  v.literal("colorectal_resection"),
  v.literal("gastric_resection"),
  v.literal("lung_biopsy"),
  v.literal("lung_resection"),
  v.literal("prostate_core"),
  v.literal("prostatectomy"),
  v.literal("endometrial_biopsy"),
  v.literal("hysterectomy"),
  v.literal("skin_excision"),
);
const status = v.union(v.literal("draft"), v.literal("ready"), v.literal("completed"));

async function ownedCase(ctx: QueryCtx | MutationCtx, caseId: Id<"cases">, userId: string): Promise<Doc<"cases">> {
  const item = await ctx.db.get(caseId);
  if (!item || item.userId !== userId) throw new Error("Case not found");
  return item;
}

export const list = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const user = await requireSession(ctx, args.sessionToken);
    return await ctx.db
      .query("cases")
      .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { sessionToken: v.string(), caseId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireSession(ctx, args.sessionToken);
    const caseId = ctx.db.normalizeId("cases", args.caseId);
    if (!caseId) return null;
    const item = await ctx.db.get(caseId);
    return item?.userId === user._id ? item : null;
  },
});

export const create = mutation({
  args: {
    sessionToken: v.string(),
    caseNumber: v.string(),
    title: v.string(),
    reportType,
  },
  handler: async (ctx, args) => {
    const user = await requireSession(ctx, args.sessionToken);
    const now = Date.now();
    return await ctx.db.insert("cases", {
      userId: user._id,
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
    sessionToken: v.string(),
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
    const user = await requireSession(ctx, args.sessionToken);
    await ownedCase(ctx, args.caseId, user._id);
    const patch: Partial<Doc<"cases">> = { updatedAt: Date.now() };
    if (args.caseNumber !== undefined) patch.caseNumber = args.caseNumber;
    if (args.title !== undefined) patch.title = args.title;
    if (args.status !== undefined) patch.status = args.status;
    if (args.specimen !== undefined) patch.specimen = args.specimen;
    if (args.clinicalHistory !== undefined) patch.clinicalHistory = args.clinicalHistory;
    if (args.grossDescription !== undefined) patch.grossDescription = args.grossDescription;
    if (args.microscopicDescription !== undefined) patch.microscopicDescription = args.microscopicDescription;
    if (args.diagnosis !== undefined) patch.diagnosis = args.diagnosis;
    if (args.comment !== undefined) patch.comment = args.comment;
    if (args.transcript !== undefined) patch.transcript = args.transcript;
    if (args.report !== undefined) patch.report = args.report;
    await ctx.db.patch(args.caseId, patch);
    return args.caseId;
  },
});

export const remove = mutation({
  args: { sessionToken: v.string(), caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const user = await requireSession(ctx, args.sessionToken);
    await ownedCase(ctx, args.caseId, user._id);
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

export const saveTranscriptForProcessing = internalMutation({
  args: {
    userId: v.string(),
    caseId: v.id("cases"),
    transcript: v.string(),
  },
  handler: async (ctx, args) => {
    await ownedCase(ctx, args.caseId, args.userId);
    await ctx.db.patch(args.caseId, {
      transcript: args.transcript,
      processingError: "",
      updatedAt: Date.now(),
    });
  },
});

export const saveProcessingFailure = internalMutation({
  args: {
    userId: v.string(),
    caseId: v.id("cases"),
    transcript: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    await ownedCase(ctx, args.caseId, args.userId);
    const patch: { transcript?: string; processingError: string; updatedAt: number } = {
      processingError: args.message,
      updatedAt: Date.now(),
    };
    if (args.transcript) patch.transcript = args.transcript;
    await ctx.db.patch(args.caseId, patch);
  },
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
      processingError: "",
      status: args.missingFields.length ? "draft" : "ready",
      updatedAt: Date.now(),
    });
  },
});

export const saveReview = internalMutation({
  args: {
    userId: v.string(),
    caseId: v.id("cases"),
    missingFields: v.array(v.string()),
    uncertainties: v.array(v.object({
      field: v.string(),
      issue: v.string(),
      sourceQuote: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    await ownedCase(ctx, args.caseId, args.userId);
    await ctx.db.patch(args.caseId, {
      missingFields: args.missingFields,
      uncertainties: args.uncertainties,
      updatedAt: Date.now(),
    });
  },
});
