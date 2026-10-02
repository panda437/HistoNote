"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronRight, FilePlus2, LoaderCircle, Mic2, Search, X } from "lucide-react";
import { jsonRequest } from "@/lib/client-api";
import type { CaseRecord, ReportType } from "@/lib/types";

const REPORT_TYPES: Record<ReportType, string> = {
  gi_biopsy: "GI biopsy",
  breast_core: "Breast core biopsy",
};

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(timestamp);
}

export function DashboardClient({ initialCases, name }: { initialCases: CaseRecord[]; name: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => initialCases.filter((item) =>
    `${item.caseNumber} ${item.title} ${REPORT_TYPES[item.reportType]}`.toLowerCase().includes(query.toLowerCase()),
  ), [initialCases, query]);

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const { id } = await jsonRequest<{ id: string }>("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          caseNumber: form.get("caseNumber"),
          title: form.get("title"),
          reportType: form.get("reportType"),
        }),
      });
      router.push(`/cases/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create case");
      setLoading(false);
    }
  }

  return (
    <main className="dashboard-page">
      <header className="page-header">
        <div><p className="overline">YOUR WORKSPACE</p><h1>Good day, {name.split(" ")[0]}</h1><p>Start a case or continue a draft.</p></div>
        <button className="button button-primary" onClick={() => setShowNew(true)}><FilePlus2 size={18} /> New case</button>
      </header>

      <section className="dashboard-metrics">
        <div><strong>{initialCases.length}</strong><span>Total cases</span></div>
        <div><strong>{initialCases.filter((item) => item.status === "draft").length}</strong><span>Drafts</span></div>
        <div><strong>{initialCases.filter((item) => item.status === "ready").length}</strong><span>Ready to review</span></div>
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
              <Link href={`/cases/${item._id}`} className="case-row" key={item._id}>
                <span className="case-title"><strong>{item.caseNumber}</strong><small>{item.title}</small></span>
                <span>{REPORT_TYPES[item.reportType]}</span>
                <span className="date-cell"><CalendarDays size={15} /> {formatDate(item.updatedAt)}</span>
                <span><i className={`status-dot ${item.status}`} /> {item.status === "ready" ? "Ready to review" : item.status}</span>
                <span><ChevronRight size={18} /></span>
              </Link>
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
              <label>Report type<select name="reportType" defaultValue="gi_biopsy"><option value="gi_biopsy">GI biopsy</option><option value="breast_core">Breast core biopsy</option></select></label>
              {error && <div className="form-error">{error}</div>}
              <button className="button button-primary modal-submit" disabled={loading}>{loading && <LoaderCircle className="spin" size={18} />} Open case <ChevronRight size={17} /></button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
