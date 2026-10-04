"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

const SESSION_STORAGE_KEY = "histonote_session";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
const convex = new ConvexReactClient(convexUrl);

type AuthSessionValue = {
  sessionToken: string | null;
  ready: boolean;
  saveSession: (token: string) => void;
  clearSession: () => void;
};

const AuthSessionContext = createContext<AuthSessionValue | null>(null);

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  const sessionToken = useSyncExternalStore(
    subscribeToSession,
    () => window.localStorage.getItem(SESSION_STORAGE_KEY),
    () => null,
  );
  const ready = useSyncExternalStore(subscribeToSession, () => true, () => false);

  const value = useMemo<AuthSessionValue>(() => ({
    sessionToken,
    ready,
    saveSession(token) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, token);
      window.dispatchEvent(new Event("histonote-session"));
    },
    clearSession() {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      window.dispatchEvent(new Event("histonote-session"));
    },
  }), [ready, sessionToken]);

  return (
    <ConvexProvider client={convex}>
      <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>
    </ConvexProvider>
  );
}

function subscribeToSession(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("histonote-session", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("histonote-session", onStoreChange);
  };
}

export function useAuthSession() {
  const value = useContext(AuthSessionContext);
  if (!value) throw new Error("useAuthSession must be used inside ConvexClientProvider");
  return value;
}
