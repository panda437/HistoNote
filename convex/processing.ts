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

const reviewOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    missingFields: { type: "array", items: { type: "string" } },
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
  },
  required: ["missingFields", "uncertainties"],
} as const;

const reviewSchema = z.object({
  missingFields: z.array(z.string()),
  uncertainties: z.array(z.object({
    field: z.string(),
    issue: z.string(),
    sourceQuote: z.string(),
  }).strict()),
}).strict();

type Review = z.infer<typeof reviewSchema>;
type ReviewDraft = {
  specimen: string;
  clinicalHistory: string;
  grossDescription: string;
  microscopicDescription: string;
  diagnosis: string;
  comment: string;
  transcript: string;
  report: string;
};

type ProcessingResult =
  | { ok: true; transcript: string; structured: Processed }
  | { ok: false; transcript: string; error: string };

type ReviewResult =
  | { ok: true; review: Review }
  | { ok: false; error: string };

class RetryableReportError extends Error {}

const CHECKLISTS: Record<string, string> = {
  gi_biopsy: "Specimen/site, clinical history, microscopic description, diagnosis. Flag laterality, number of fragments, dysplasia, organism status, and ancillary studies only when relevant or mentioned; never assume them.",
  breast_core: "Specimen/site and laterality, clinical/imaging context, microscopic description, diagnosis. Flag grade, in-situ component, lymphovascular invasion, calcification, and biomarker plans only when relevant or mentioned; never assume them.",
  breast_excision: "Specimen/site and laterality, procedure, clinical/imaging context, microscopic description, and diagnosis. Flag lesion size, margins, in-situ or invasive component, nodes, and biomarker status only when relevant or mentioned; never assume them.",
  colorectal_resection: "Specimen and procedure, site, clinical history, microscopic description, and diagnosis. Flag tumour dimensions, depth, margins, lymphovascular/perineural invasion, nodes, deposits, and ancillary studies only when relevant or mentioned; never infer staging.",
  gastric_resection: "Specimen and procedure, site, clinical history, microscopic description, and diagnosis. Flag tumour dimensions, depth, margins, lymphovascular/perineural invasion, nodes, treatment response, and ancillary studies only when relevant or mentioned; never infer staging.",
  lung_biopsy: "Specimen/site and laterality, procedure, clinical/imaging context, microscopic description, and diagnosis. Flag tumour typing, adequacy, necrosis, and ancillary or molecular studies only when relevant or mentioned; never assume them.",
  lung_resection: "Specimen/site and laterality, procedure, clinical history, microscopic description, and diagnosis. Flag tumour dimensions, pleural or lymphovascular invasion, margins, nodes, spread through air spaces, and ancillary studies only when relevant or mentioned; never infer staging.",
  prostate_core: "Specimen labels/sites, clinical history, microscopic description, and diagnosis. Flag involved cores, tumour extent, grade information, perineural invasion, and ancillary studies only when relevant or mentioned; never calculate or assume them.",
  prostatectomy: "Specimen and procedure, clinical history, microscopic description, and diagnosis. Flag grade information, tumour extent, extraprostatic or seminal vesicle involvement, margins, nodes, and ancillary studies only when relevant or mentioned; never infer staging.",
  endometrial_biopsy: "Specimen and procedure, clinical history, microscopic description, and diagnosis. Flag adequacy, histologic type and grade, background endometrium, and ancillary studies only when relevant or mentioned; never assume them.",
  hysterectomy: "Specimen and procedure, organs/sites represented, clinical history, microscopic description, and diagnosis. Flag tumour dimensions, depth or extent, lymphovascular invasion, margins, nodes, and ancillary studies only when relevant or mentioned; never infer staging.",
  skin_excision: "Specimen/site and procedure, clinical history, microscopic description, and diagnosis. Flag lesion dimensions, depth or thickness, ulceration, mitotic activity, lymphovascular/perineural invasion, and margins only when relevant or mentioned; never infer staging.",
};

function parseReview(response: Response): Review {
  const refusal = refusalText(response);
  if (refusal) throw new Error("The review model declined this request");
  if (response.status !== "completed" || response.error || !response.output_text) {
    throw new Error(response.error?.message || `Gap review ended with status ${response.status}`);
  }
  return reviewSchema.parse(JSON.parse(response.output_text));
}

function words(value: string) {
  return value.trim().split(/\s+/).filter(Boolean);
}

export function buildApproximateSegments(transcript: string, suppliedDurationMs?: number) {
  const clean = transcript.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const allWords = words(clean);
  const durationMs = suppliedDurationMs && suppliedDurationMs > 0
    ? suppliedDurationMs
    : Math.max(4000, allWords.length * 420);
  const millisecondsPerWord = durationMs / Math.max(1, allWords.length);
  const targetWords = Math.max(10, Math.min(32, Math.round(12000 / millisecondsPerWord)));
  const sentences = clean.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [clean];
  const units = sentences.flatMap((sentence) => {
    const sentenceWords = words(sentence);
    if (sentenceWords.length <= Math.ceil(targetWords * 1.5)) return [sentence];
    const chunks: string[] = [];
    for (let index = 0; index < sentenceWords.length; index += targetWords) {
      chunks.push(sentenceWords.slice(index, index + targetWords).join(" "));
    }
    return chunks;
  });

  const grouped: string[] = [];
  let current = "";
  for (const unit of units) {
    const combined = current ? `${current} ${unit}` : unit;
    if (current && words(combined).length > Math.ceil(targetWords * 1.35) && words(current).length >= 10) {
      grouped.push(current);
      current = unit;
    } else {
      current = combined;
    }
  }
  if (current) grouped.push(current);
  if (grouped.length > 1 && words(grouped.at(-1) || "").length < 8) {
    grouped[grouped.length - 2] = `${grouped[grouped.length - 2]} ${grouped.pop()}`;
  }

  let consumedWords = 0;
  return grouped.map((text, index) => {
    const startMs = Math.round(consumedWords * millisecondsPerWord);
    consumedWords += words(text).length;
    const endMs = index === grouped.length - 1
      ? Math.round(durationMs)
      : Math.round(consumedWords * millisecondsPerWord);
    return { startMs, endMs, text };
  });
}

function mergeRecordingTranscript(existing: string, incoming: string, previous?: string) {
  const base = existing.trim();
  const next = incoming.trim();
  const prior = previous?.trim();
  if (!base) return next;
  if (prior && base.includes(prior)) return base.replace(prior, next).trim();
  if (base.includes(next)) return base;
  return `${base}\n\n${next}`;
}

function normalizeReview(review: Review, draft: ReviewDraft, reportType: string): Review {
  const populatedAliases: Array<[keyof ReviewDraft, string[]]> = [
    ["specimen", ["specimen"]],
    ["clinicalHistory", ["clinical history"]],
    ["grossDescription", ["gross description"]],
    ["microscopicDescription", ["microscopic description", "microscopy"]],
    ["diagnosis", ["diagnosis"]],
    ["comment", ["comment"]],
  ];
  const biopsyTypes = new Set(["gi_biopsy", "breast_core", "lung_biopsy", "prostate_core", "endometrial_biopsy"]);
  const seenMissing = new Set<string>();
  const missingFields = review.missingFields.filter((item) => {
    const clean = item.trim();
    const normalized = clean.toLowerCase();
    if (!clean || seenMissing.has(normalized)) return false;
    if (biopsyTypes.has(reportType) && normalized === "gross description") return false;
    const alreadyPresent = populatedAliases.some(([field, aliases]) =>
      draft[field].trim() && aliases.some((alias) => normalized === alias || normalized.startsWith(`${alias}:`)),
    );
    if (alreadyPresent) return false;
    seenMissing.add(normalized);
    return true;
  });

  const seenUncertainties = new Set<string>();
  const uncertaintySignals = ["conflict", "contradict", "inconsisten", "discrep", "ambig", "unclear", "uncertain"];
  const uncertainties = review.uncertainties.filter((item) => {
    const issue = item.issue.trim();
    const signature = `${item.field.toLowerCase()}|${issue.toLowerCase()}`;
    if (!issue || seenUncertainties.has(signature)) return false;
    if (!uncertaintySignals.some((signal) => issue.toLowerCase().includes(signal))) return false;
    seenUncertainties.add(signature);
    return true;
  });
  return { missingFields, uncertainties };
}

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
          "Use the cumulative dictation in chronological order. A later explicit correction may update an earlier statement; otherwise surface contradictions for review instead of silently choosing one.",
          "Preserve supported clinician-edited content from the existing draft unless the cumulative dictation explicitly corrects it.",
          "Leave unsupported fields as empty strings and list required omissions in missingFields.",
          "Keep the report concise. It is an editable draft for pathologist review and must contain no unsupported facts.",
          "Complete every required JSON field before finishing.",
        ].join(" "),
        input: [
          `REPORT TYPE: ${caseItem.reportType}`,
          `REQUIRED REVIEW CHECKLIST: ${CHECKLISTS[caseItem.reportType]}`,
          `EXISTING CASE LABEL: ${caseItem.caseNumber}`,
          "EXISTING CLINICIAN-EDITABLE DRAFT:",
          JSON.stringify({
            specimen: caseItem.specimen,
            clinicalHistory: caseItem.clinicalHistory,
            grossDescription: caseItem.grossDescription,
            microscopicDescription: caseItem.microscopicDescription,
            diagnosis: caseItem.diagnosis,
            comment: caseItem.comment,
            report: caseItem.report,
          }),
          "CUMULATIVE DICTATION (oldest to newest):",
          transcript,
        ].join("\n\n"),
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
    let processingAssetId: typeof args.assetId;
    let assetTranscribed = false;

    try {
      if (!transcript) {
        if (!args.assetId) throw new Error("A recording or transcript is required");
        processingAssetId = args.assetId;
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
        const recordingTranscript = transcription.text.trim();
        if (!recordingTranscript) throw new Error("No speech was detected in the recording");
        const transcriptSegments = buildApproximateSegments(recordingTranscript, asset.durationMs);
        await ctx.runMutation(internal.assets.saveTranscription, {
          userId: user._id,
          assetId: asset._id,
          transcript: recordingTranscript,
          transcriptSegments,
        });
        assetTranscribed = true;
        transcript = mergeRecordingTranscript(caseItem.transcript, recordingTranscript, asset.transcript);
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
      if (processingAssetId && !assetTranscribed) {
        await ctx.runMutation(internal.assets.saveProcessingFailure, {
          userId: user._id,
          assetId: processingAssetId,
          message: "Transcription failed. Retry this saved recording.",
        });
      }
      return { ok: false, transcript, error: message };
    }
  },
});

export const checkGaps = action({
  args: {
    sessionToken: v.string(),
    caseId: v.id("cases"),
    draft: v.object({
      specimen: v.string(),
      clinicalHistory: v.string(),
      grossDescription: v.string(),
      microscopicDescription: v.string(),
      diagnosis: v.string(),
      comment: v.string(),
      transcript: v.string(),
      report: v.string(),
    }),
  },
  handler: async (ctx, args): Promise<ReviewResult> => {
    const user = await ctx.runQuery(internal.auth.getUserForSession, {
      sessionToken: args.sessionToken,
    });
    const caseItem: Doc<"cases"> = await ctx.runQuery(internal.cases.getForProcessing, {
      userId: user._id,
      caseId: args.caseId,
    });

    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const model = process.env.OPENAI_REPORT_MODEL || "gpt-5-mini";
      const response = await client.responses.create({
        model,
        instructions: [
          "You are a completeness and consistency checker for a histopathologist, not a diagnostic system.",
          "Review only the supplied case content. Never invent a diagnosis, stage, measurement, or clinical fact.",
          "List a missing item only when the report type checklist makes it relevant and the supplied case does not address it.",
          "Identify explicit unresolved conflicts across the cumulative dictation and draft. Do not flag a statement that the pathologist clearly corrected later.",
          "Never list a populated field as missing. Do not require a gross description for a biopsy or core-biopsy report unless the supplied content makes it relevant.",
          "Use uncertainties only for an explicit unresolved conflict, ambiguous wording, or genuinely unclear statement. Missing detail belongs only in missingFields, never in uncertainties.",
          "Use a short exact source quote for each conflict when available, otherwise use an empty string.",
          "This is a pre-completion review. Return concise, actionable items for the pathologist.",
        ].join(" "),
        input: [
          `REPORT TYPE: ${caseItem.reportType}`,
          `REVIEW CHECKLIST: ${CHECKLISTS[caseItem.reportType]}`,
          "CURRENT CASE:",
          JSON.stringify(args.draft),
        ].join("\n\n"),
        text: {
          format: {
            type: "json_schema",
            name: "pathology_gap_review",
            strict: true,
            schema: reviewOutputSchema,
          },
        },
        reasoning: model.startsWith("gpt-5") ? { effort: "minimal" } : undefined,
        max_output_tokens: 4000,
        store: false,
      });
      const review = normalizeReview(parseReview(response), args.draft, caseItem.reportType);
      await ctx.runMutation(internal.cases.saveReview, {
        userId: user._id,
        caseId: args.caseId,
        ...review,
      });
      return { ok: true, review };
    } catch (error) {
      console.error("Gap review failed", error);
      return { ok: false, error: "The gap check could not be completed. Your case is unchanged; please retry." };
    }
  },
});
