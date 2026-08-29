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
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.32, ease: "easeInOut" }}
        className="h-[calc(100vh-49px)]"
        data-tab-index={index}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
