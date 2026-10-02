"use node";

import OpenAI from "openai";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { assertServiceSecret } from "./security";

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    specimen: { type: "string", description: "Specimen explicitly stated in the dictation, otherwise empty." },
    clinicalHistory: { type: "string", description: "Clinical history explicitly stated, otherwise empty." },
    grossDescription: { type: "string", description: "Gross findings explicitly stated, otherwise empty." },
    microscopicDescription: { type: "string", description: "Microscopic findings explicitly stated, otherwise empty." },
    diagnosis: { type: "string", description: "Diagnosis explicitly dictated by the pathologist, otherwise empty." },
    comment: { type: "string", description: "Comments explicitly dictated, otherwise empty." },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string" },
          sourceQuote: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["field", "sourceQuote", "confidence"],
      },
    },
    uncertainties: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string" },
          issue: { type: "string" },
          sourceQuote: { type: "string" },
        },
        required: ["field", "issue", "sourceQuote"],
      },
    },
    missingFields: { type: "array", items: { type: "string" } },
    report: { type: "string", description: "A concise draft report containing only supported findings." },
  },
  required: [
    "specimen",
    "clinicalHistory",
    "grossDescription",
    "microscopicDescription",
    "diagnosis",
    "comment",
    "evidence",
    "uncertainties",
    "missingFields",
    "report",
  ],
} as const;

type Processed = {
  specimen: string;
  clinicalHistory: string;
  grossDescription: string;
  microscopicDescription: string;
  diagnosis: string;
  comment: string;
  evidence: Array<{ field: string; sourceQuote: string; confidence: "high" | "medium" | "low" }>;
  uncertainties: Array<{ field: string; issue: string; sourceQuote: string }>;
  missingFields: string[];
  report: string;
};

const CHECKLISTS: Record<string, string> = {
  gi_biopsy: "Specimen/site, clinical history, microscopic description, diagnosis. Flag laterality, number of fragments, dysplasia, organism status, and ancillary studies only when relevant or mentioned; never assume them.",
  breast_core: "Specimen/site and laterality, clinical/imaging context, microscopic description, diagnosis. Flag grade, in-situ component, lymphovascular invasion, calcification, and biomarker plans only when relevant or mentioned; never assume them.",
};

export const run = action({
  args: {
    secret: v.string(),
    userId: v.string(),
    caseId: v.id("cases"),
    assetId: v.optional(v.id("assets")),
    transcript: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ transcript: string; structured: Processed }> => {
    assertServiceSecret(args.secret);
    const caseItem: Doc<"cases"> = await ctx.runQuery(internal.cases.getForProcessing, {
      userId: args.userId,
      caseId: args.caseId,
    });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let transcript = args.transcript?.trim() ?? "";

    if (!transcript) {
      if (!args.assetId) throw new Error("A recording or transcript is required");
      const asset: Doc<"assets"> = await ctx.runQuery(internal.assets.getForProcessing, {
        userId: args.userId,
        assetId: args.assetId,
      });
      if (asset.caseId !== args.caseId) throw new Error("Recording does not belong to this case");
      const audio = await ctx.storage.get(asset.storageId);
      if (!audio) throw new Error("Recording file is unavailable");

      const file = new File([await audio.arrayBuffer()], asset.filename, {
        type: asset.mimeType || "audio/webm",
      });
      const transcription = await client.audio.transcriptions.create({
        model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
        file,
        prompt: "Histopathology dictation. Preserve medical terminology, measurements, specimen labels, laterality, negations, grading, and uncertainty exactly.",
      });
      transcript = transcription.text.trim();
    }

    if (!transcript) throw new Error("No speech was detected in the recording");

    const response = await client.responses.create({
      model: process.env.OPENAI_REPORT_MODEL || "gpt-5-mini",
      instructions: [
        "You are a transcription-structuring assistant for a histopathologist, not a diagnostic system.",
        "Use only facts explicitly supported by the supplied dictation. Never invent, infer, complete, or default a clinical finding.",
        "Lightly normalize grammar and pathology formatting without changing clinical meaning.",
        "Evidence must contain exactly one item for each non-empty clinical field (specimen, clinicalHistory, grossDescription, microscopicDescription, diagnosis, comment). Never add evidence items for report.",
        "Put unclear, conflicting, or low-confidence language in uncertainties. Preserve negation and measurements exactly.",
        "Leave unsupported fields as empty strings and list required omissions in missingFields.",
        "The report is an editable draft for pathologist review and must contain no unsupported facts.",
      ].join(" "),
      input: `REPORT TYPE: ${caseItem.reportType}\nREQUIRED REVIEW CHECKLIST: ${CHECKLISTS[caseItem.reportType]}\nEXISTING CASE LABEL: ${caseItem.caseNumber}\n\nDICTATION:\n${transcript}`,
      text: {
        format: {
          type: "json_schema",
          name: "pathology_report_draft",
          strict: true,
          schema: outputSchema,
        },
      },
      max_output_tokens: 3200,
    });

    if (!response.output_text) throw new Error("The report model returned no structured output");
    const structured = JSON.parse(response.output_text) as Processed;

    await ctx.runMutation(internal.cases.saveProcessed, {
      userId: args.userId,
      caseId: args.caseId,
      transcript,
      ...structured,
    });

    return { transcript, structured };
  },
});
