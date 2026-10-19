"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";

export default function ResultBar({ share, selected }: { share: number; selected: boolean }) {
  const reduceMotion = useReducedMotion();
  const scale = useMotionValue(share);

  useEffect(() => {
    if (reduceMotion) {
      scale.set(share);
      return;
    }
    const controls = animate(scale, share, { duration: 0.36, ease: "easeOut" });
    return controls.stop;
  }, [reduceMotion, scale, share]);

  return (
    <motion.span
      className={`block h-full origin-left ${selected ? "bg-accent" : "bg-foreground/30"}`}
      style={{ scaleX: scale }}
    />
  );
}
