export const REPORT_TYPE_LABELS = {
  gi_biopsy: "GI biopsy",
  breast_core: "Breast core biopsy",
  breast_excision: "Breast excision",
  colorectal_resection: "Colorectal resection",
  gastric_resection: "Gastric resection",
  lung_biopsy: "Lung biopsy",
  lung_resection: "Lung resection",
  prostate_core: "Prostate core biopsy",
  prostatectomy: "Prostatectomy",
  endometrial_biopsy: "Endometrial biopsy",
  hysterectomy: "Hysterectomy",
  skin_excision: "Skin excision",
} as const;

export type ReportType = keyof typeof REPORT_TYPE_LABELS;
export type CaseStatus = "draft" | "ready" | "completed";

export type EvidenceItem = {
  field: string;
  sourceQuote: string;
  confidence: "high" | "medium" | "low";
};

export type UncertaintyItem = {
  field: string;
  issue: string;
  sourceQuote: string;
};

export type CaseRecord = {
  _id: string;
  _creationTime: number;
  userId: string;
  caseNumber: string;
  title: string;
  reportType: ReportType;
  status: CaseStatus;
  specimen: string;
  clinicalHistory: string;
  grossDescription: string;
  microscopicDescription: string;
  diagnosis: string;
  comment: string;
  transcript: string;
  report: string;
  evidence: EvidenceItem[];
  uncertainties: UncertaintyItem[];
  missingFields: string[];
  processingError?: string;
  createdAt: number;
  updatedAt: number;
};

export type CaseAsset = {
  _id: string;
  _creationTime: number;
  caseId: string;
  userId: string;
  storageId: string;
  kind: "audio" | "image";
  filename: string;
  mimeType: string;
  size: number;
  recordedAt?: number;
  durationMs?: number;
  transcript?: string;
  transcriptSegments?: Array<{
    startMs: number;
    endMs: number;
    text: string;
  }>;
  processingError?: string;
  createdAt: number;
  url: string | null;
};
