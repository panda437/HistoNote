"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMutation } from "convex/react";
import { FilePlus2, FolderKanban, LogOut, Settings, ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useAuthSession } from "@/components/ConvexClientProvider";
import { Logo } from "@/components/Logo";

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: { name?: string | null; email?: string | null };
}) {
  const pathname = usePathname();
  const { sessionToken, clearSession } = useAuthSession();
  const signOut = useMutation(api.auth.signOut);
  const initials = (user.name || user.email || "P")
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  async function handleSignOut() {
    if (sessionToken) await signOut({ sessionToken }).catch(() => undefined);
    clearSession();
    // Use a document navigation to clear authenticated client state completely.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div>
          <Logo />
          <nav className="nav-list" aria-label="Primary navigation">
            <Link className={pathname === "/dashboard" ? "active" : ""} href="/dashboard">
              <FolderKanban size={18} /> Cases
            </Link>
            <Link href="/dashboard?new=1">
              <FilePlus2 size={18} /> New case
            </Link>
          </nav>
        </div>
        <div className="sidebar-foot">
          <div className="privacy-chip"><ShieldCheck size={15} /> Private workspace</div>
          <button className="nav-button" type="button" disabled title="Settings coming soon">
            <Settings size={18} /> Settings
          </button>
          <button className="profile-button" type="button" onClick={handleSignOut}>
            <span className="avatar">{initials}</span>
            <span className="profile-copy">
              <strong>{user.name || "Pathologist"}</strong>
              <small>{user.email}</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="app-content">{children}</div>
    </div>
  );
}
