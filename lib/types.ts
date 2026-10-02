export type ReportType = "gi_biopsy" | "breast_core";
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
  createdAt: number;
  url: string | null;
};
