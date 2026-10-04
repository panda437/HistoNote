"use client";

import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuthSession } from "@/components/ConvexClientProvider";
import { AppShell } from "@/components/AppShell";

export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const { sessionToken, ready, clearSession } = useAuthSession();
  const user = useQuery(api.auth.currentUser, sessionToken ? { sessionToken } : "skip");

  useEffect(() => {
    if (!ready) return;
    if (!sessionToken || user === null) {
      if (user === null) clearSession();
      window.location.replace("/login");
    }
  }, [clearSession, ready, sessionToken, user]);

  if (!ready || !sessionToken || user === undefined || user === null) {
    return <main className="case-loading"><div className="skeleton wide" /><div className="skeleton-grid"><div className="skeleton" /><div className="skeleton" /></div></main>;
  }

  return <AppShell user={user}>{children}</AppShell>;
}
