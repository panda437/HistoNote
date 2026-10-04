import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    name: v.string(),
    passwordHash: v.string(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  sessions: defineTable({
    userId: v.string(),
    token: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_user", ["userId"]),

  cases: defineTable({
    userId: v.string(),
    caseNumber: v.string(),
    title: v.string(),
    reportType: v.union(v.literal("gi_biopsy"), v.literal("breast_core")),
    status: v.union(v.literal("draft"), v.literal("ready"), v.literal("completed")),
    specimen: v.string(),
    clinicalHistory: v.string(),
    grossDescription: v.string(),
    microscopicDescription: v.string(),
    diagnosis: v.string(),
    comment: v.string(),
    transcript: v.string(),
    report: v.string(),
    evidence: v.array(
      v.object({
        field: v.string(),
        sourceQuote: v.string(),
        confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
      }),
    ),
    uncertainties: v.array(
      v.object({
        field: v.string(),
        issue: v.string(),
        sourceQuote: v.string(),
      }),
    ),
    missingFields: v.array(v.string()),
    processingError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_updated", ["userId", "updatedAt"]),

  assets: defineTable({
    userId: v.string(),
    caseId: v.id("cases"),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("audio"), v.literal("image")),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
    createdAt: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_user", ["userId"]),
});
