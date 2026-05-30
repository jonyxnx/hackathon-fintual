import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "kitdoc - Full GitHub repo documentation",
  description: "Turn a GitHub repository into full, in-depth, Notion-ready documentation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased bg-[#fffdf7] text-stone-900">{children}</body>
    </html>
  );
}
