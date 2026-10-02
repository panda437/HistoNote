import Link from "next/link";

export function Logo({ compact = false, href = "/dashboard" }: { compact?: boolean; href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="HistoNote home">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {!compact && <span>HistoNote</span>}
    </Link>
  );
}
