import type { Metadata } from "next";
import { Geist, Geist_Mono, Archivo_Black } from "next/font/google";
import "./globals.css";
import { TabBar } from "@/components/TabBar";
import { PageTransition } from "@/components/PageTransition";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Bold condensed display face for section headings, inspired by the editorial
// blog-style typography reference (tall slab headline over clean sans body).
const displayFont = Archivo_Black({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "RallySafe Paranoia",
  description: "Track your friends live on stage — texts for stage starts, finishes, times, and stalls.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${displayFont.variable} antialiased h-full bg-[#05070c] text-neutral-100`}
      >
        <TabBar />
        <PageTransition>{children}</PageTransition>
      </body>
    </html>
  );
}
