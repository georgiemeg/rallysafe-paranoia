"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";

const TAB_ORDER = ["/", "/live", "/results"];

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const index = TAB_ORDER.indexOf(pathname);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -16 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="h-[calc(100vh-49px)]"
        data-tab-index={index}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
