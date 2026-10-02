import Link from "next/link";

export default function CaseNotFound() {
  return <main className="not-found"><p className="overline">CASE NOT FOUND</p><h1>This case is not in your workspace.</h1><p>It may have been removed, or the link belongs to another account.</p><Link className="button button-primary" href="/dashboard">Return to cases</Link></main>;
}
