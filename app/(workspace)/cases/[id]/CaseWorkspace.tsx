"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clipboard,
  FileAudio,
  ImagePlus,
  ListChecks,
  LoaderCircle,
  Mic2,
  Save,
  ShieldAlert,
  Sparkles,
  Square,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuthSession } from "@/components/ConvexClientProvider";
import { REPORT_TYPE_LABELS, type CaseRecord } from "@/lib/types";

const SILENCE_LIMIT_MS = 3 * 60 * 1000;
const FIELD_LABELS: Record<string, string> = {
  specimen: "Specimen",
  clinicalHistory: "Clinical history",
  grossDescription: "Gross description",
  microscopicDescription: "Microscopic description",
  diagnosis: "Diagnosis",
  comment: "Comment",
};

type EditableField = keyof Pick<CaseRecord,
  "specimen" | "clinicalHistory" | "grossDescription" | "microscopicDescription" | "diagnosis" | "comment" | "transcript" | "report"
>;

type CasePatch = Partial<Pick<CaseRecord,
  "caseNumber" | "title" | "status" | "specimen" | "clinicalHistory" | "grossDescription" | "microscopicDescription" | "diagnosis" | "comment" | "transcript" | "report"
>>;

function clock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function reportTypeLabel(type: CaseRecord["reportType"]) {
  return REPORT_TYPE_LABELS[type];
}

function friendlyMissing(value: string) {
  if (FIELD_LABELS[value]) return FIELD_LABELS[value];
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function timecode(milliseconds: number) {
  return clock(Math.max(0, Math.floor(milliseconds / 1000)));
}

function recordingDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

async function audioDuration(file: File) {
  return await new Promise<number | undefined>((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    let settled = false;
    const finish = (value?: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(), 3500);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined);
    audio.onerror = () => finish();
    audio.src = url;
  });
}

export function CaseWorkspace({ caseId }: { caseId: string }) {
  const { sessionToken } = useAuthSession();
  const remoteCase = useQuery(api.cases.get, sessionToken ? { sessionToken, caseId } : "skip");
  const remoteAssets = useQuery(
    api.assets.list,
    sessionToken && remoteCase
      ? { sessionToken, caseId: remoteCase._id }
      : "skip",
  );
  const updateCase = useMutation(api.cases.update);
  const generateUploadUrl = useMutation(api.assets.generateUploadUrl);
  const attachAsset = useMutation(api.assets.attach);
  const processDictation = useAction(api.processing.run);
  const checkCaseGaps = useAction(api.processing.checkGaps);
  const [localCase, setCaseItem] = useState<CaseRecord | null>(null);
  const caseItem = localCase ?? (remoteCase ? remoteCase as CaseRecord : null);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [silenceFor, setSilenceFor] = useState(0);
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [copied, setCopied] = useState(false);
  const [checkingGaps, setCheckingGaps] = useState(false);
  const [completionReview, setCompletionReview] = useState<{
    missingFields: string[];
    uncertainties: CaseRecord["uncertainties"];
  } | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timersRef = useRef<number[]>([]);
  const lastSpeechRef = useRef(0);
  const startedRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const discardRef = useRef(false);
  const recordingUploadRef = useRef<HTMLInputElement | null>(null);

  async function savePatch(patch: CasePatch) {
    if (!sessionToken || !caseItem) return;
    setSaveState("saving");
    try {
      await updateCase({
        sessionToken,
        caseId: caseItem._id as Id<"cases">,
        ...patch,
      });
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  function edit(field: EditableField, value: string) {
    if (!caseItem) return;
    setCaseItem((current) => current ? { ...current, [field]: value } : current);
    setSaveState("saving");
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => savePatch({ [field]: value }), 900);
  }

  async function uploadAsset(
    file: File,
    kind: "audio" | "image",
    metadata: { recordedAt?: number; durationMs?: number } = {},
  ) {
    if (!sessionToken || !caseItem) throw new Error("Your session has expired");
    const uploadUrl = await generateUploadUrl({
      sessionToken,
      caseId: caseItem._id as Id<"cases">,
    });
    const upload = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!upload.ok) throw new Error("File upload failed");
    const { storageId } = await upload.json() as { storageId: Id<"_storage"> };
    const assetId = await attachAsset({
      sessionToken,
      caseId: caseItem._id as Id<"cases">,
      storageId,
      kind,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      ...(metadata.recordedAt ? { recordedAt: metadata.recordedAt } : {}),
      ...(metadata.durationMs ? { durationMs: metadata.durationMs } : {}),
    });
    return { assetId };
  }

  async function runProcessing(input: { assetId?: Id<"assets">; transcript?: string }) {
    if (!sessionToken || !caseItem) throw new Error("Your session has expired");
    const result = await processDictation({
      sessionToken,
      caseId: caseItem._id as Id<"cases">,
      ...input,
    });
    if (!result.ok) throw new Error(result.error);
    setCaseItem((current) => {
      const base = current ?? caseItem;
      if (!base) return current;
      return {
        ...base,
        transcript: result.transcript,
        ...result.structured,
        processingError: "",
        status: result.structured.missingFields.length ? "draft" : "ready",
      };
    });
    return result;
  }

  function clearRecorderResources() {
    timersRef.current.forEach((timer) => window.clearInterval(timer));
    timersRef.current = [];
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLevel(0);
  }

  async function handleFinishedRecording(blob: Blob) {
    if (discardRef.current || !blob.size || !caseItem) return;
    setProcessing(true);
    setCaseItem((current) => current ? { ...current, processingError: "" } : current);
    setNotice("Saving recording…");
    setError("");
    try {
      const extension = blob.type.includes("mp4") ? "m4a" : "webm";
      const file = new File([blob], `${caseItem.caseNumber}-dictation-${Date.now()}.${extension}`, { type: blob.type });
      const recordedAt = startedRef.current || Date.now();
      const { assetId } = await uploadAsset(file, "audio", {
        recordedAt,
        durationMs: Math.max(1000, Date.now() - recordedAt),
      });
      setNotice("Transcribing and structuring…");
      await runProcessing({ assetId });
      setNotice("Draft updated from your dictation.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process recording");
      setNotice("");
    } finally {
      setProcessing(false);
    }
  }

  function stopRecording(reason: "manual" | "silence" = "manual") {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setNotice(reason === "silence" ? "Stopped after three minutes of silence." : "Recording stopped.");
    recorder.stop();
    setRecording(false);
    clearRecorderResources();
  }

  async function startRecording() {
    setError("");
    setNotice("");
    discardRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const preferred = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || preferred || "audio/webm" });
        recorderRef.current = null;
        void handleFinishedRecording(blob);
      };

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      startedRef.current = Date.now();
      lastSpeechRef.current = Date.now();

      const monitor = window.setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / samples.length);
        setLevel(Math.min(1, rms * 12));
        if (rms > 0.018) lastSpeechRef.current = Date.now();
        const quietMs = Date.now() - lastSpeechRef.current;
        setSilenceFor(Math.floor(quietMs / 1000));
        if (quietMs >= SILENCE_LIMIT_MS) stopRecording("silence");
      }, 400);
      const ticker = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)), 1000);
      timersRef.current = [monitor, ticker];
      recorder.start(1000);
      setElapsed(0);
      setSilenceFor(0);
      setRecording(true);

      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (recorder.state !== "inactive") stopRecording("manual");
      });
    } catch (err) {
      clearRecorderResources();
      setError(err instanceof Error ? err.message : "Microphone access failed");
    }
  }

  async function processTranscript() {
    if (!caseItem?.transcript.trim()) return;
    setProcessing(true);
    setCaseItem((current) => current ? { ...current, processingError: "" } : current);
    setError("");
    setNotice("Structuring your edited transcript…");
    try {
      await runProcessing({ transcript: caseItem.transcript });
      setNotice("Structured draft refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not structure transcript");
    } finally {
      setProcessing(false);
    }
  }

  async function retryRecording(assetId: Id<"assets">) {
    setProcessing(true);
    setCaseItem((current) => current ? { ...current, processingError: "" } : current);
    setError("");
    setNotice("Retrying transcription and report drafting…");
    try {
      await runProcessing({ assetId });
      setNotice("Draft recovered from the saved recording.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process the saved recording");
      setNotice("");
    } finally {
      setProcessing(false);
    }
  }

  async function uploadRecording(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !caseItem) return;
    setProcessing(true);
    setUploadingRecording(true);
    setCaseItem((current) => current ? { ...current, processingError: "" } : current);
    setError("");
    setNotice("Uploading your recording…");
    try {
      const durationMs = await audioDuration(file);
      const { assetId } = await uploadAsset(file, "audio", {
        recordedAt: Date.now(),
        durationMs,
      });
      setNotice("Transcribing and structuring the uploaded recording…");
      await runProcessing({ assetId });
      setNotice("Draft updated from your uploaded recording.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process the uploaded recording");
      setNotice("");
    } finally {
      setUploadingRecording(false);
      setProcessing(false);
      event.target.value = "";
    }
  }

  async function uploadImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of files) await uploadAsset(file, "image");
      setNotice(`${files.length} image${files.length > 1 ? "s" : ""} saved to this case.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function runGapCheck(forCompletion = false) {
    if (!sessionToken || !caseItem) return;
    setCheckingGaps(true);
    setError("");
    setNotice("Checking the full case for gaps and conflicts…");
    try {
      const result = await checkCaseGaps({
        sessionToken,
        caseId: caseItem._id as Id<"cases">,
        draft: {
          specimen: caseItem.specimen,
          clinicalHistory: caseItem.clinicalHistory,
          grossDescription: caseItem.grossDescription,
          microscopicDescription: caseItem.microscopicDescription,
          diagnosis: caseItem.diagnosis,
          comment: caseItem.comment,
          transcript: caseItem.transcript,
          report: caseItem.report || buildReport(caseItem),
        },
      });
      if (!result.ok) throw new Error(result.error);
      setCaseItem((current) => current ? {
        ...current,
        missingFields: result.review.missingFields,
        uncertainties: result.review.uncertainties,
      } : current);
      if (forCompletion) setCompletionReview(result.review);
      setNotice(result.review.missingFields.length || result.review.uncertainties.length
        ? "Review complete. Items needing attention are listed."
        : "Review complete. No gaps or conflicts were flagged.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check this case");
      setNotice("");
    } finally {
      setCheckingGaps(false);
    }
  }

  async function markComplete() {
    if (!caseItem) return;
    if (caseItem.status === "completed") {
      await savePatch({ status: "draft" });
      setCaseItem((current) => current ? { ...current, status: "draft" } : current);
      return;
    }
    await runGapCheck(true);
  }

  async function confirmComplete() {
    if (!caseItem) return;
    await savePatch({ status: "completed" });
    setCaseItem((current) => current ? { ...current, status: "completed" } : current);
    setCompletionReview(null);
  }

  async function copyReport() {
    if (!caseItem) return;
    await navigator.clipboard.writeText(caseItem.report || buildReport(caseItem));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  useEffect(() => () => {
    discardRef.current = true;
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    clearRecorderResources();
  }, []);

  if (remoteCase === undefined || !caseItem) {
    if (remoteCase === null) {
      return <main className="not-found"><p className="overline">CASE NOT FOUND</p><h1>This case is not in your workspace.</h1><p>It may have been removed, or the link belongs to another account.</p><Link className="button button-primary" href="/dashboard">Return to cases</Link></main>;
    }
    return <main className="case-loading"><div className="skeleton wide" /><div className="skeleton-grid"><div className="skeleton" /><div className="skeleton" /></div></main>;
  }

  const assets = remoteAssets ?? [];
  const audioAssets = assets.filter((asset) => asset.kind === "audio");
  const imageAssets = assets.filter((asset) => asset.kind === "image");
  const silenceLeft = Math.max(0, Math.ceil((SILENCE_LIMIT_MS - silenceFor * 1000) / 1000));

  return (
    <main className="case-workspace">
      <header className="case-header">
        <div className="case-heading">
          <Link href="/dashboard" aria-label="Back to cases"><ArrowLeft size={19} /></Link>
          <div><div className="case-kicker"><span>{reportTypeLabel(caseItem.reportType)}</span><span>•</span><span>{caseItem.caseNumber}</span></div><h1>{caseItem.title}</h1></div>
        </div>
        <div className="case-header-actions">
          <span className={`save-indicator ${saveState}`}>{saveState === "saving" ? <LoaderCircle className="spin" /> : saveState === "error" ? <XCircle /> : <Check />} {saveState === "saving" ? "Saving" : saveState === "error" ? "Save failed" : "Saved"}</span>
          <button className={`button ${caseItem.status === "completed" ? "button-quiet" : "button-primary"}`} onClick={markComplete} disabled={checkingGaps}>
            {checkingGaps ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />} {caseItem.status === "completed" ? "Reopen" : "Mark complete"}
          </button>
        </div>
      </header>

      {(notice || error) && <div className={`toast-inline ${error ? "error" : ""}`}>{error ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}{error || notice}<button onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss">×</button></div>}
      {!error && caseItem.processingError && <div className="toast-inline error"><AlertCircle size={17} />{caseItem.processingError}{caseItem.transcript.trim() && <button onClick={processTranscript} disabled={processing}>Retry from saved transcript</button>}</div>}

      <div className="workspace-grid">
        <div className="workspace-main">
          <section className={`dictation-card ${recording ? "is-recording" : ""}`}>
            <div className="dictation-top">
              <div><p className="overline">DICTATION</p><h2>{recording ? "Listening continuously" : processing ? "Working on your draft" : "Record naturally"}</h2></div>
              <span className="record-rule"><i /> Manual stop or 3 min silence</span>
            </div>

            <div className="recorder-stage">
              <div className="record-controls">
                <button
                  className={`record-button ${recording ? "stop" : ""}`}
                  type="button"
                  onClick={recording ? () => stopRecording("manual") : startRecording}
                  disabled={processing}
                  aria-label={recording ? "Stop recording" : "Start recording"}
                >
                  {processing && !uploadingRecording ? <LoaderCircle className="spin" size={29} /> : recording ? <Square size={25} fill="currentColor" /> : <Mic2 size={31} />}
                </button>
                <button
                  className="recording-upload-button"
                  type="button"
                  onClick={() => recordingUploadRef.current?.click()}
                  disabled={processing || recording}
                  aria-label="Upload an audio recording"
                  title="Upload an audio recording"
                >
                  {uploadingRecording ? <LoaderCircle className="spin" size={16} /> : <UploadCloud size={17} />}
                </button>
                <input
                  ref={recordingUploadRef}
                  className="recording-upload-input"
                  type="file"
                  accept=".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm,audio/*"
                  onChange={uploadRecording}
                  disabled={processing || recording}
                />
              </div>
              <div className="record-status">
                <strong>{recording ? clock(elapsed) : uploadingRecording ? "Uploading…" : processing ? "Processing…" : "Press to start"}</strong>
                <span>{recording ? `Auto-stop in ${clock(silenceLeft)} if silence continues` : "Record here or upload audio from another recorder"}</span>
              </div>
              <div className={`live-wave ${recording ? "active" : ""}`} aria-hidden="true">
                {Array.from({ length: 34 }, (_, index) => (
                  <i key={index} style={{ height: `${recording ? Math.max(5, level * (18 + ((index * 13) % 38))) : 4}px` }} />
                ))}
              </div>
            </div>
            <div className="recorder-assurance"><ShieldAlert size={15} /> HistoNote does not stop for ordinary pauses. The silence timer resets whenever speech is detected.</div>

            <div className="transcript-head"><div><h3>Combined transcript</h3><small>Every recording is added to this case</small></div><button className="text-button" onClick={processTranscript} disabled={processing || !caseItem.transcript.trim()}><Sparkles size={15} /> Update draft</button></div>
            <textarea className="transcript-editor" value={caseItem.transcript} onChange={(e) => edit("transcript", e.target.value)} placeholder="Your cumulative transcript will appear here after the first recording stops. You can also type or paste dictation." />
            {audioAssets.length > 0 && <div className="recording-list">
              <div className="recording-list-head"><strong>All recordings ({audioAssets.length})</strong><span>Timeline timestamps are approximate</span></div>
              {[...audioAssets].sort((a, b) => a.createdAt - b.createdAt).map((asset, index) => <section className="recording-item" key={asset._id}>
                <div className="recording-item-head">
                  <div><FileAudio size={16} /><span><strong>Recording {index + 1}</strong><small>{recordingDate(asset.recordedAt || asset.createdAt)}{asset.durationMs ? ` · ${timecode(asset.durationMs)}` : ""}</small></span></div>
                  <button className="text-button" onClick={() => retryRecording(asset._id)} disabled={processing}>Retry</button>
                </div>
                {asset.url && <audio controls preload="metadata" src={asset.url} />}
                {asset.processingError && <p className="recording-error"><AlertCircle size={13} />{asset.processingError}</p>}
                {asset.transcriptSegments?.length ? <div className="recording-timeline">
                  {asset.transcriptSegments.map((segment, segmentIndex) => <div key={`${asset._id}-${segmentIndex}`}><time>{timecode(segment.startMs)}–{timecode(segment.endMs)}</time><p>{segment.text}</p></div>)}
                </div> : asset.transcript ? <p className="recording-transcript">{asset.transcript}</p> : <p className="recording-pending">No saved transcript for this recording yet. Retry to add it to the timeline.</p>}
              </section>)}
            </div>}
          </section>

          <section className="structured-section">
            <div className="section-title"><div><p className="overline">STRUCTURED CASE</p><h2>What the report will use</h2></div><span><Save size={15} /> Auto-saved</span></div>
            <div className="field-grid">
              {(Object.keys(FIELD_LABELS) as EditableField[]).map((field) => (
                <label className={field === "microscopicDescription" || field === "diagnosis" ? "field-wide" : ""} key={field}>
                  <span>{FIELD_LABELS[field]}{caseItem.missingFields.some((missing) => missing.toLowerCase().includes(FIELD_LABELS[field].toLowerCase())) && <i>Missing</i>}</span>
                  <textarea value={caseItem[field]} onChange={(e) => edit(field, e.target.value)} placeholder={`No ${FIELD_LABELS[field].toLowerCase()} captured yet`} />
                </label>
              ))}
            </div>
          </section>

          <section className="report-section">
            <div className="section-title"><div><p className="overline">FINAL DRAFT</p><h2>Editable report</h2></div><button className="button button-quiet" onClick={copyReport}><Clipboard size={16} /> {copied ? "Copied" : "Copy report"}</button></div>
            <textarea className="report-editor" value={caseItem.report || buildReport(caseItem)} onChange={(e) => edit("report", e.target.value)} placeholder="Process a dictation to generate the report." />
            <p className="clinical-note"><ShieldAlert size={14} /> Drafting assistance only. Review every statement before sign-out.</p>
          </section>
        </div>

        <aside className="workspace-aside">
          <section className="review-card">
            <p className="overline">REVIEW QUEUE</p>
            <h3>{caseItem.missingFields.length ? `${caseItem.missingFields.length} item${caseItem.missingFields.length > 1 ? "s" : ""} need attention` : "No required omissions flagged"}</h3>
            <div className="review-list">
              {caseItem.missingFields.length ? caseItem.missingFields.map((item, index) => <div className="missing-item" key={`${item}-${index}`}><AlertCircle size={17} /><span>{friendlyMissing(item)}</span></div>) : <div className="complete-item"><CheckCircle2 size={17} /><span>Required fields are present. Verify the content.</span></div>}
            </div>
            <button className="button button-quiet gap-check-button" onClick={() => runGapCheck(false)} disabled={checkingGaps || processing}>
              {checkingGaps ? <LoaderCircle className="spin" size={16} /> : <ListChecks size={16} />} Check for gaps
            </button>
          </section>

          {caseItem.uncertainties.length > 0 && <section className="review-card uncertainty-card">
            <p className="overline">UNCERTAIN</p>
            {caseItem.uncertainties.map((item, index) => <div className="uncertainty-item" key={`${item.field}-${index}`}><strong>{item.field}</strong><p>{item.issue}</p>{item.sourceQuote && <q>{item.sourceQuote}</q>}</div>)}
          </section>}

          <section className="review-card evidence-card">
            <p className="overline">TRACEABILITY</p>
            <h3>What came from the dictation</h3>
            {caseItem.evidence.length ? <div className="evidence-list">{caseItem.evidence.map((item, index) => <div key={`${item.field}-${index}`}><span><i className={item.confidence} />{FIELD_LABELS[item.field] || item.field}</span><q>{item.sourceQuote}</q></div>)}</div> : <p className="muted">Process a recording to see the exact source behind each field.</p>}
          </section>

          <section className="review-card image-card">
            <div className="image-card-head"><div><p className="overline">CASE IMAGES</p><h3>{imageAssets.length ? `${imageAssets.length} saved` : "Add reference images"}</h3></div><label className="icon-upload" title="Upload images"><input type="file" accept="image/*" multiple onChange={uploadImages} disabled={uploading} />{uploading ? <LoaderCircle className="spin" /> : <ImagePlus />}</label></div>
            {imageAssets.length ? <div className="image-grid">{imageAssets.map((asset) => asset.url ? <a href={asset.url} target="_blank" rel="noreferrer" key={asset._id}><Image unoptimized width={140} height={120} src={asset.url} alt={asset.filename} /><span>{asset.filename}</span></a> : null)}</div> : <label className="image-drop"><input type="file" accept="image/*" multiple onChange={uploadImages} disabled={uploading} /><UploadCloud size={22} /><span>Upload gross or reference images</span><small>Images are saved only to this case</small></label>}
          </section>
        </aside>
      </div>

      {completionReview && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCompletionReview(null); }}>
        <section className="modal completion-modal" role="dialog" aria-modal="true" aria-labelledby="completion-review-title">
          <button className="modal-close" onClick={() => setCompletionReview(null)} aria-label="Close">×</button>
          <p className="overline">PRE-COMPLETION REVIEW</p>
          <h2 id="completion-review-title">{completionReview.missingFields.length || completionReview.uncertainties.length ? "Review before completing" : "No gaps were flagged"}</h2>
          <p>{completionReview.missingFields.length || completionReview.uncertainties.length ? "HistoNote found information that may need your attention. You can keep editing or complete the case after reviewing it." : "The automated check found no missing information or unresolved conflicts. Please still verify the full report before sign-out."}</p>
          {completionReview.missingFields.length > 0 && <div className="completion-review-group"><strong>Missing information</strong>{completionReview.missingFields.map((item, index) => <div className="missing-item" key={`${item}-${index}`}><AlertCircle size={16} /><span>{friendlyMissing(item)}</span></div>)}</div>}
          {completionReview.uncertainties.length > 0 && <div className="completion-review-group"><strong>Conflicts or uncertainty</strong>{completionReview.uncertainties.map((item, index) => <div className="completion-conflict" key={`${item.field}-${index}`}><ShieldAlert size={16} /><span><b>{item.field}</b>{item.issue}{item.sourceQuote && <q>{item.sourceQuote}</q>}</span></div>)}</div>}
          <div className="completion-actions"><button className="button button-quiet" onClick={() => setCompletionReview(null)}>Keep editing</button><button className="button button-primary" onClick={confirmComplete}>Complete anyway</button></div>
        </section>
      </div>}
    </main>
  );
}

function buildReport(item: CaseRecord) {
  const sections = [
    ["SPECIMEN", item.specimen],
    ["CLINICAL HISTORY", item.clinicalHistory],
    ["GROSS DESCRIPTION", item.grossDescription],
    ["MICROSCOPIC DESCRIPTION", item.microscopicDescription],
    ["DIAGNOSIS", item.diagnosis],
    ["COMMENT", item.comment],
  ].filter(([, value]) => value.trim());
  return sections.map(([label, value]) => `${label}\n${value}`).join("\n\n");
}
