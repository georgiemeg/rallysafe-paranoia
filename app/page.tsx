"use client";

import { useNarrow } from "@/lib/useNarrow";
import { HomeDesktop } from "@/components/home/HomeDesktop";
import { HomeMobile } from "@/components/home/HomeMobile";

export default function HomePage() {
  const narrow = useNarrow();
  if (narrow === null) {
    return <div className="min-h-[calc(100vh-49px)] bg-[#0a0e14]" />;
  }
  return narrow ? <HomeMobile /> : <HomeDesktop />;
}
