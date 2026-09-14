"use client";

import { useNarrow } from "@/lib/useNarrow";
import { ResultsDesktop } from "@/components/results/ResultsDesktop";
import { ResultsMobile } from "@/components/results/ResultsMobile";

export default function ResultsPage() {
  const narrow = useNarrow();
  if (narrow === null) {
    return <div className="min-h-[calc(100vh-49px)] bg-[#0a0e14]" />;
  }
  return narrow ? <ResultsMobile /> : <ResultsDesktop />;
}
