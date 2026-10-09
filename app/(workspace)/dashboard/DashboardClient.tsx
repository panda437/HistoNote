"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { CalendarDays, ChevronRight, FilePlus2, LoaderCircle, Mic2, Search, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useAuthSession } from "@/components/ConvexClientProvider";
import { REPORT_TYPE_LABELS, type ReportType } from "@/lib/types";

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(timestamp);
}

export function DashboardClient() {
  const { sessionToken } = useAuthSession();
  const currentUser = useQuery(api.auth.currentUser, sessionToken ? { sessionToken } : "skip");
  const cases = useQuery(api.cases.list, sessionToken ? { sessionToken } : "skip");
  const createCaseMutation = useMutation(api.cases.create);
  const params = useSearchParams();
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const caseItems = cases ?? [];
  const filtered = caseItems.filter((item) =>
    `${item.caseNumber} ${item.title} ${REPORT_TYPE_LABELS[item.reportType]}`.toLowerCase().includes(query.toLowerCase()),
  );

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      if (!sessionToken) throw new Error("Your session has expired");
      const id = await createCaseMutation({
        sessionToken,
        caseNumber: String(form.get("caseNumber") || ""),
        title: String(form.get("title") || ""),
        reportType: String(form.get("reportType") || "gi_biopsy") as ReportType,
      });
      // Convex static hosting resolves this dynamic path through the SPA fallback.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/cases/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create case");
      setLoading(false);
    }
  }

  return (
    <main className="dashboard-page">
      <header className="page-header">
        <div><p className="overline">YOUR WORKSPACE</p><h1>Good day, {(currentUser?.name || "Doctor").split(" ")[0]}</h1><p>Start a case or continue a draft.</p></div>
        <button className="button button-primary" onClick={() => setShowNew(true)}><FilePlus2 size={18} /> New case</button>
      </header>

      <section className="dashboard-metrics">
        <div><strong>{caseItems.length}</strong><span>Total cases</span></div>
        <div><strong>{caseItems.filter((item) => item.status === "draft").length}</strong><span>Drafts</span></div>
        <div><strong>{caseItems.filter((item) => item.status === "ready").length}</strong><span>Ready to review</span></div>
        <div className="metric-accent"><Mic2 size={20} /><span>Voice-first reporting</span></div>
      </section>

      <section className="case-list-section">
        <div className="section-toolbar">
          <div><h2>Recent cases</h2><p>Only cases in your account are shown here.</p></div>
          <label className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search cases" /></label>
        </div>
        {filtered.length ? (
          <div className="case-table">
            <div className="case-row case-row-head"><span>Case</span><span>Report type</span><span>Updated</span><span>Status</span><span /></div>
            {filtered.map((item) => (
              <a href={`/cases/${item._id}`} className="case-row" key={item._id}>
                <span className="case-title"><strong>{item.caseNumber}</strong><small>{item.title}</small></span>
                <span>{REPORT_TYPE_LABELS[item.reportType]}</span>
                <span className="date-cell"><CalendarDays size={15} /> {formatDate(item.updatedAt)}</span>
                <span><i className={`status-dot ${item.status}`} /> {item.status === "ready" ? "Ready to review" : item.status}</span>
                <span><ChevronRight size={18} /></span>
              </a>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon"><Mic2 size={25} /></div>
            <h3>{query ? "No matching cases" : "Your first report starts here"}</h3>
            <p>{query ? "Try another case number or title." : "Create a case, press record, and dictate naturally."}</p>
            {!query && <button className="button button-primary" onClick={() => setShowNew(true)}>Create first case</button>}
          </div>
        )}
      </section>

      {showNew && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-case-title">
            <button className="modal-close" onClick={() => setShowNew(false)} aria-label="Close"><X size={19} /></button>
            <p className="overline">NEW REPORT</p>
            <h2 id="new-case-title">Start a case</h2>
            <p>Just enough context to keep the dictation organized.</p>
            <form onSubmit={createCase}>
              <label>Case / accession number<input name="caseNumber" required autoFocus placeholder="e.g. H26-00418" /></label>
              <label>Short label <span>(optional)</span><input name="title" placeholder="e.g. Gastric biopsy" /></label>
              <label>Report type<select name="reportType" defaultValue="gi_biopsy">{Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              {error && <div className="form-error">{error}</div>}
              <button className="button button-primary modal-submit" disabled={loading}>{loading && <LoaderCircle className="spin" size={18} />} Open case <ChevronRight size={17} /></button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
