import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Synapse AI - Production-Grade Agent Orchestration & Observability",
  description:
    "High-performance AI workflow canvas, multi-model streaming studio, and real-time LLM telemetry engine.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#090a0f] text-gray-100 antialiased selection:bg-indigo-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
