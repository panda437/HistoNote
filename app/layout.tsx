import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HistoNote", template: "%s · HistoNote" },
  description: "Voice-first structured reporting for histopathologists.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
