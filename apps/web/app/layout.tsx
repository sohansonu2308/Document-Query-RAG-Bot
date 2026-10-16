import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumen · RAG research workspace",
  description: "A local-first RAG workspace with an interactive study guide for retrieval, grounding, and citations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
