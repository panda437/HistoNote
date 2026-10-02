"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clipboard,
  FileAudio,
  ImagePlus,
  LoaderCircle,
  Mic2,
  Save,
  ShieldAlert,
  Sparkles,
  Square,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { jsonRequest, uploadCaseAsset } from "@/lib/client-api";
import type { CaseAsset, CaseRecord } from "@/lib/types";

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

function clock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function reportTypeLabel(type: CaseRecord["reportType"]) {
  return type === "gi_biopsy" ? "GI biopsy" : "Breast core biopsy";
}

function friendlyMissing(value: string) {
  if (FIELD_LABELS[value]) return FIELD_LABELS[value];
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

export function CaseWorkspace({ initialCase, initialAssets }: { initialCase: CaseRecord; initialAssets: CaseAsset[] }) {
  const [caseItem, setCaseItem] = useState(initialCase);
  const [assets, setAssets] = useState(initialAssets);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [silenceFor, setSilenceFor] = useState(0);
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [copied, setCopied] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timersRef = useRef<number[]>([]);
  const lastSpeechRef = useRef(0);
  const startedRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const discardRef = useRef(false);

  async function reloadCase() {
    const data = await jsonRequest<{ case: CaseRecord; assets: CaseAsset[] }>(`/api/cases/${caseItem._id}`);
    setCaseItem(data.case);
    setAssets(data.assets);
  }

  async function savePatch(patch: Partial<CaseRecord>) {
    setSaveState("saving");
    try {
      await jsonRequest(`/api/cases/${caseItem._id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  function edit(field: EditableField, value: string) {
    setCaseItem((current) => ({ ...current, [field]: value }));
    setSaveState("saving");
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => savePatch({ [field]: value }), 900);
  }

  function clearRecorderResources() {
    timersRef.current.forEach((timer) => window.clearInterval(timer));
    timersRef.current = [];
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLevel(0);
  }

  async function handleFinishedRecording(blob: Blob) {
    if (discardRef.current || !blob.size) return;
    setProcessing(true);
    setNotice("Saving recording…");
    setError("");
    try {
      const extension = blob.type.includes("mp4") ? "m4a" : "webm";
      const file = new File([blob], `${caseItem.caseNumber}-dictation-${Date.now()}.${extension}`, { type: blob.type });
      const { assetId } = await uploadCaseAsset(caseItem._id, file, "audio");
      setNotice("Transcribing and structuring…");
      await jsonRequest(`/api/cases/${caseItem._id}/process`, {
        method: "POST",
        body: JSON.stringify({ assetId }),
      });
      await reloadCase();
      setNotice("Draft updated from your dictation.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process recording");
      setNotice("");
      await reloadCase().catch(() => undefined);
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
    if (!caseItem.transcript.trim()) return;
    setProcessing(true);
    setError("");
    setNotice("Structuring your edited transcript…");
    try {
      await jsonRequest(`/api/cases/${caseItem._id}/process`, {
        method: "POST",
        body: JSON.stringify({ transcript: caseItem.transcript }),
      });
      await reloadCase();
      setNotice("Structured draft refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not structure transcript");
    } finally {
      setProcessing(false);
    }
  }

  async function uploadImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of files) await uploadCaseAsset(caseItem._id, file, "image");
      await reloadCase();
      setNotice(`${files.length} image${files.length > 1 ? "s" : ""} saved to this case.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function markComplete() {
    await savePatch({ status: caseItem.status === "completed" ? "draft" : "completed" });
    setCaseItem((current) => ({ ...current, status: current.status === "completed" ? "draft" : "completed" }));
  }

  async function copyReport() {
    await navigator.clipboard.writeText(caseItem.report || buildReport(caseItem));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  useEffect(() => () => {
    discardRef.current = true;
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    clearRecorderResources();
  }, []);

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
          <button className={`button ${caseItem.status === "completed" ? "button-quiet" : "button-primary"}`} onClick={markComplete}>
            <CheckCircle2 size={17} /> {caseItem.status === "completed" ? "Reopen" : "Mark complete"}
          </button>
        </div>
      </header>

      {(notice || error) && <div className={`toast-inline ${error ? "error" : ""}`}>{error ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}{error || notice}<button onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss">×</button></div>}

      <div className="workspace-grid">
        <div className="workspace-main">
          <section className={`dictation-card ${recording ? "is-recording" : ""}`}>
            <div className="dictation-top">
              <div><p className="overline">DICTATION</p><h2>{recording ? "Listening continuously" : processing ? "Working on your draft" : "Record naturally"}</h2></div>
              <span className="record-rule"><i /> Manual stop or 3 min silence</span>
            </div>

            <div className="recorder-stage">
              <button
                className={`record-button ${recording ? "stop" : ""}`}
                type="button"
                onClick={recording ? () => stopRecording("manual") : startRecording}
                disabled={processing}
                aria-label={recording ? "Stop recording" : "Start recording"}
              >
                {processing ? <LoaderCircle className="spin" size={29} /> : recording ? <Square size={25} fill="currentColor" /> : <Mic2 size={31} />}
              </button>
              <div className="record-status">
                <strong>{recording ? clock(elapsed) : processing ? "Processing…" : "Press to start"}</strong>
                <span>{recording ? `Auto-stop in ${clock(silenceLeft)} if silence continues` : "Recording will continue through pauses"}</span>
              </div>
              <div className={`live-wave ${recording ? "active" : ""}`} aria-hidden="true">
                {Array.from({ length: 34 }, (_, index) => (
                  <i key={index} style={{ height: `${recording ? Math.max(5, level * (18 + ((index * 13) % 38))) : 4}px` }} />
                ))}
              </div>
            </div>
            <div className="recorder-assurance"><ShieldAlert size={15} /> HistoNote does not stop for ordinary pauses. The silence timer resets whenever speech is detected.</div>

            <div className="transcript-head"><h3>Transcript</h3><button className="text-button" onClick={processTranscript} disabled={processing || !caseItem.transcript.trim()}><Sparkles size={15} /> Structure edited transcript</button></div>
            <textarea className="transcript-editor" value={caseItem.transcript} onChange={(e) => edit("transcript", e.target.value)} placeholder="Your transcript will appear here after the recording stops. You can also type or paste dictation." />
            {audioAssets.length > 0 && <div className="recording-list">
              {audioAssets.slice(0, 3).map((asset) => <div key={asset._id}><FileAudio size={16} /><span>{asset.filename}</span>{asset.url && <audio controls preload="metadata" src={asset.url} />}</div>)}
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
