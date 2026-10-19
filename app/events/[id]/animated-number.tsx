"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";

export default function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: "integer" | "percent";
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const current = useMotionValue(value);
  const formatted = useTransform(() => {
    const latest = current.get();
    return format === "percent"
      ? new Intl.NumberFormat(undefined, {
          style: "percent",
          maximumFractionDigits: 0,
        }).format(latest)
      : new Intl.NumberFormat().format(Math.round(latest));
  });

  useEffect(() => {
    if (reduceMotion) {
      current.set(value);
      return;
    }
    const controls = animate(current, value, { duration: 0.38, ease: "easeOut" });
    return controls.stop;
  }, [current, reduceMotion, value]);

  return (
    <motion.span className={className}>
      {formatted}
    </motion.span>
  );
}
