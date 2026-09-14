"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useNarrow } from "@/lib/useNarrow";
import { LiveDesktop } from "@/components/live/LiveDesktop";

export default function LivePage() {
  const narrow = useNarrow();
  const router = useRouter();

  useEffect(() => {
    if (narrow === true) router.replace("/");
  }, [narrow, router]);

  if (narrow === null || narrow === true) {
    return <div className="min-h-[calc(100vh-49px)] bg-[#0a0e14]" />;
  }
  return <LiveDesktop />;
}
