"use client";

import { Suspense, useSyncExternalStore } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowRight, CheckCircle2, Mic2, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Logo } from "@/components/Logo";
import { useAuthSession } from "@/components/ConvexClientProvider";
import { WorkspaceGate } from "@/components/WorkspaceGate";
import { CaseWorkspace } from "@/app/(workspace)/cases/[id]/CaseWorkspace";
import { DashboardClient } from "@/app/(workspace)/dashboard/DashboardClient";
import { LoginForm } from "@/app/login/LoginForm";

export default function HomePage() {
  const browserPath = useSyncExternalStore(
    () => () => undefined,
    () => window.location.pathname,
    () => null,
  );

  if (browserPath === null) {
    return <main className="case-loading"><div className="skeleton wide" /><div className="skeleton-grid"><div className="skeleton" /><div className="skeleton" /></div></main>;
  }

  const caseMatch = browserPath.match(/^\/cases\/([^/]+)\/?$/);
  if (caseMatch) {
    return <WorkspaceGate><CaseWorkspace caseId={decodeURIComponent(caseMatch[1])} /></WorkspaceGate>;
  }

  if (/^\/dashboard\/?$/.test(browserPath)) {
    return <WorkspaceGate><Suspense><DashboardClient /></Suspense></WorkspaceGate>;
  }

  if (/^\/login\/?$/.test(browserPath)) {
    return <Suspense><LoginForm /></Suspense>;
  }

  return <MarketingHome />;
}

function MarketingHome() {
  const { sessionToken } = useAuthSession();
  const user = useQuery(api.auth.currentUser, sessionToken ? { sessionToken } : "skip");
  const signedIn = Boolean(user);
  return (
    <main className="marketing-page">
      <header className="marketing-nav">
        <Logo />
        <Link className="button button-quiet" href={signedIn ? "/dashboard" : "/login"}>
          {signedIn ? "Open workspace" : "Sign in"} <ArrowRight size={16} />
        </Link>
      </header>
      <section className="hero">
        <div className="eyebrow"><Sparkles size={15} /> Built around the reporting moment</div>
        <h1>Dictate a case.<br /><em>Get a structured report.</em></h1>
        <p className="hero-lede">
          Keep your eyes on the slide. HistoNote turns natural dictation into an editable report,
          shows exactly what supports each field, and flags what is still missing.
        </p>
        <div className="hero-actions">
          <Link className="button button-primary button-large" href={signedIn ? "/dashboard?new=1" : "/login?mode=signup"}>
            <Mic2 size={19} /> Dictate your first case
          </Link>
          <span><ShieldCheck size={16} /> Your cases stay in your workspace</span>
        </div>
        <div className="workflow-preview">
          <div className="workflow-voice">
            <div className="recording-orb"><Mic2 size={26} /></div>
            <div>
              <small>LIVE DICTATION</small>
              <p>“Gastric antral biopsy shows mild chronic inflammation. No Helicobacter organisms identified…”</p>
            </div>
            <div className="wave" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} />)}</div>
          </div>
          <div className="workflow-arrow"><ArrowRight size={20} /></div>
          <div className="workflow-report">
            <small>STRUCTURED DRAFT</small>
            <h3>Microscopic description</h3>
            <p>Sections show gastric antral mucosa with mild chronic inflammation.</p>
            <h3>Diagnosis</h3>
            <p>Gastric antral biopsy — mild chronic gastritis.</p>
            <div className="missing-preview"><span>Needs review</span> Clinical history</div>
          </div>
        </div>
      </section>
      <section className="value-strip">
        <div><CheckCircle2 /><strong>Words stay traceable</strong><span>See the dictation behind every populated field.</span></div>
        <div><CheckCircle2 /><strong>Nothing silently invented</strong><span>Unsupported fields stay blank and visible.</span></div>
        <div><CheckCircle2 /><strong>One continuous recording</strong><span>Manual stop or three minutes of silence.</span></div>
      </section>
      <footer className="marketing-footer">
        <span>HistoNote</span>
        <p>Drafting assistance only. All reports require review and sign-out by a qualified pathologist.</p>
      </footer>
    </main>
  );
}
