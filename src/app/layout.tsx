import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "kitdoc - Concise repo docs",
  description: "Generate concise developer docs, an agent guide, and a file map from a GitHub repository.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased bg-[#fffdf7] text-stone-900">{children}</body>
    </html>
  );
}
