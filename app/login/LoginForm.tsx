"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowRight, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/Logo";
import { jsonRequest } from "@/lib/client-api";

export function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">(params.get("mode") === "signup" ? "signup" : "login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");
    try {
      if (mode === "signup") {
        await jsonRequest("/api/signup", {
          method: "POST",
          body: JSON.stringify({ name: form.get("name"), email, password }),
        });
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) throw new Error(mode === "signup" ? "Account created, but sign-in failed" : "Incorrect email or password");
      router.push("/dashboard");
      router.refresh();
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
