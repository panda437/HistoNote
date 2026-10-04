"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { ArrowRight, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Logo } from "@/components/Logo";
import { useAuthSession } from "@/components/ConvexClientProvider";

export function LoginForm() {
  const params = useSearchParams();
  const { sessionToken, ready, saveSession } = useAuthSession();
  const currentUser = useQuery(api.auth.currentUser, sessionToken ? { sessionToken } : "skip");
  const signIn = useAction(api.authActions.signIn);
  const signUp = useAction(api.authActions.signUp);
  const [mode, setMode] = useState<"login" | "signup">(params.get("mode") === "signup" ? "signup" : "login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (ready && currentUser) window.location.replace("/dashboard");
  }, [currentUser, ready]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");
    try {
      const result = mode === "signup"
        ? await signUp({ name: String(form.get("name") || ""), email, password })
        : await signIn({ email, password });
      saveSession(result.token);
      // Use a document navigation so the static-hosting SPA fallback owns the route.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-brand"><Logo href="/" /></div>
      <section className="auth-card">
        <div className="auth-icon"><LockKeyhole size={23} /></div>
        <p className="overline">PRIVATE PATHOLOGY WORKSPACE</p>
        <h1>{mode === "login" ? "Welcome back" : "Create your workspace"}</h1>
        <p>{mode === "login" ? "Pick up your cases where you left off." : "Start with one case. No configuration required."}</p>
        <form method="post" onSubmit={submit}>
          {mode === "signup" && <label>Full name<input name="name" type="text" required minLength={2} autoComplete="name" placeholder="Dr. A. Rao" /></label>}
          <label>Email address<input name="email" type="email" required autoComplete="email" placeholder="you@hospital.org" /></label>
          <label>Password<input name="password" type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="At least 8 characters" /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-primary auth-submit" disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={18} /> : null}
            {mode === "login" ? "Sign in" : "Create workspace"} <ArrowRight size={17} />
          </button>
        </form>
        <button className="auth-switch" type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>
          {mode === "login" ? "New to HistoNote? Create an account" : "Already have an account? Sign in"}
        </button>
        <div className="auth-note"><ShieldCheck size={16} /> Your cases are isolated to your signed-in workspace.</div>
      </section>
      <p className="auth-disclaimer">For drafting assistance only — not a diagnostic system.</p>
    </main>
  );
}
