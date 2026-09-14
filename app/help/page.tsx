"use client";

import { useNarrow } from "@/lib/useNarrow";
import { HelpDesktop } from "@/components/help/HelpDesktop";
import { HelpMobile } from "@/components/help/HelpMobile";

export default function HelpPage() {
  const narrow = useNarrow();
  if (narrow === null) {
    return <div className="min-h-[calc(100vh-49px)] bg-[#0a0e14]" />;
  }
  return narrow ? <HelpMobile /> : <HelpDesktop />;
}
