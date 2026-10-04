"use node";

import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";
import { v } from "convex/values";
import { z } from "zod";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

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

const processedSchema = z.object({
  specimen: z.string(),
  clinicalHistory: z.string(),
  grossDescription: z.string(),
  microscopicDescription: z.string(),
  diagnosis: z.string(),
  comment: z.string(),
  evidence: z.array(z.object({
    field: z.string(),
    sourceQuote: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
  }).strict()),
  uncertainties: z.array(z.object({
    field: z.string(),
    issue: z.string(),
    sourceQuote: z.string(),
  }).strict()),
  missingFields: z.array(z.string()),
  report: z.string(),
}).strict();

type Processed = z.infer<typeof processedSchema>;

type ProcessingResult =
  | { ok: true; transcript: string; structured: Processed }
  | { ok: false; transcript: string; error: string };

class RetryableReportError extends Error {}

const CHECKLISTS: Record<string, string> = {
  gi_biopsy: "Specimen/site, clinical history, microscopic description, diagnosis. Flag laterality, number of fragments, dysplasia, organism status, and ancillary studies only when relevant or mentioned; never assume them.",
  breast_core: "Specimen/site and laterality, clinical/imaging context, microscopic description, diagnosis. Flag grade, in-situ component, lymphovascular invasion, calcification, and biomarker plans only when relevant or mentioned; never assume them.",
};

function refusalText(response: Response) {
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const content of item.content) {
      if (content.type === "refusal") return content.refusal;
    }
  }
  return "";
}

export function parseStructuredReport(response: Response): Processed {
  const refusal = refusalText(response);
  if (refusal) throw new Error("The report model declined this request");

  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason || "unknown reason";
    if (reason === "max_output_tokens") {
      throw new RetryableReportError(`Report output was incomplete: ${reason}`);
    }
    throw new Error(`Report output was incomplete: ${reason}`);
  }
  if (response.status !== "completed" || response.error) {
    throw new Error(response.error?.message || `Report generation ended with status ${response.status}`);
  }
  if (!response.output_text) throw new RetryableReportError("The report model returned no structured output");

  try {
    return processedSchema.parse(JSON.parse(response.output_text));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Invalid structured report";
    throw new RetryableReportError(detail);
  }
}

async function generateStructuredReport(client: OpenAI, caseItem: Doc<"cases">, transcript: string) {
  const model = process.env.OPENAI_REPORT_MODEL || "gpt-5-mini";
  const attempts = [6000, 12000];
  let lastError: unknown;

  for (const maxOutputTokens of attempts) {
    try {
      const response = await client.responses.create({
        model,
        instructions: [
          "You are a transcription-structuring assistant for a histopathologist, not a diagnostic system.",
          "Use only facts explicitly supported by the supplied dictation. Never invent, infer, complete, or default a clinical finding.",
          "Lightly normalize grammar and pathology formatting without changing clinical meaning.",
          "Evidence must contain exactly one item for each non-empty clinical field (specimen, clinicalHistory, grossDescription, microscopicDescription, diagnosis, comment). Never add evidence items for report.",
          "Keep each evidence sourceQuote and uncertainty sourceQuote under 240 characters while preserving the exact supporting wording.",
          "Put unclear, conflicting, or low-confidence language in uncertainties. Preserve negation and measurements exactly.",
          "Leave unsupported fields as empty strings and list required omissions in missingFields.",
          "Keep the report concise. It is an editable draft for pathologist review and must contain no unsupported facts.",
          "Complete every required JSON field before finishing.",
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
        reasoning: model.startsWith("gpt-5") ? { effort: "minimal" } : undefined,
        max_output_tokens: maxOutputTokens,
        store: false,
      });
      return parseStructuredReport(response);
    } catch (error) {
      lastError = error;
      if (!(error instanceof RetryableReportError) || maxOutputTokens === attempts.at(-1)) throw error;
    }
  }

  throw lastError;
}

export const run = action({
  args: {
    sessionToken: v.string(),
    caseId: v.id("cases"),
    assetId: v.optional(v.id("assets")),
    transcript: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ProcessingResult> => {
    const user = await ctx.runQuery(internal.auth.getUserForSession, {
      sessionToken: args.sessionToken,
    });
    const caseItem: Doc<"cases"> = await ctx.runQuery(internal.cases.getForProcessing, {
      userId: user._id,
      caseId: args.caseId,
    });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let transcript = args.transcript?.trim() ?? "";

    try {
      if (!transcript) {
        if (!args.assetId) throw new Error("A recording or transcript is required");
        const asset: Doc<"assets"> = await ctx.runQuery(internal.assets.getForProcessing, {
          userId: user._id,
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

      await ctx.runMutation(internal.cases.saveTranscriptForProcessing, {
        userId: user._id,
        caseId: args.caseId,
        transcript,
      });

      const structured = await generateStructuredReport(client, caseItem, transcript);
      await ctx.runMutation(internal.cases.saveProcessed, {
        userId: user._id,
        caseId: args.caseId,
        transcript,
        ...structured,
      });

      return { ok: true, transcript, structured };
    } catch (error) {
      console.error("Processing pipeline failed", error);
      const message = transcript
        ? "Your transcript was saved, but the report draft could not be completed. Retry from the saved transcript."
        : "Your recording was saved, but transcription could not be completed. Retry the saved recording.";
      const failure: {
        userId: string;
        caseId: typeof args.caseId;
        transcript?: string;
        message: string;
      } = {
        userId: user._id,
        caseId: args.caseId,
        message,
      };
      if (transcript) failure.transcript = transcript;
      await ctx.runMutation(internal.cases.saveProcessingFailure, failure);
      return { ok: false, transcript, error: message };
    }
  },
});
