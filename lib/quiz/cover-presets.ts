import type { QuizCoverKind as DbQuizCoverKind, QuizCoverMeta } from "@/db/schema/app";

export type QuizCoverKind = DbQuizCoverKind;

export type QuizCoverPreset = {
  id: string;
  label: string;
  group: "gradient" | "pattern" | "illustration";
  background: string;
};

export const QUIZ_COVER_PRESETS: QuizCoverPreset[] = [
  {
    id: "copper-paper",
    label: "Copper paper",
    group: "gradient",
    background: "linear-gradient(115deg, var(--accent-hover), var(--accent))",
  },
  {
    id: "warm-parchment",
    label: "Warm parchment",
    group: "gradient",
    background: "linear-gradient(120deg, var(--surface-2), var(--surface-1))",
  },
  {
    id: "linen",
    label: "Linen",
    group: "pattern",
    background:
      "repeating-linear-gradient(135deg, var(--surface-2) 0 2px, var(--surface-1) 2px 10px)",
  },
  {
    id: "woven",
    label: "Woven paper",
    group: "pattern",
    background:
      "repeating-linear-gradient(0deg, transparent 0 8px, color-mix(in oklab, var(--accent) 10%, transparent) 8px 9px), repeating-linear-gradient(90deg, var(--surface-1) 0 8px, var(--surface-2) 8px 9px)",
  },
  {
    id: "orbit",
    label: "Orbit",
    group: "illustration",
    background:
      "radial-gradient(ellipse at 78% 30%, var(--surface-1) 0 8%, transparent 8.5%), radial-gradient(ellipse at 84% 42%, color-mix(in oklab, var(--accent) 22%, var(--surface-1)) 0 18%, transparent 18.5%), linear-gradient(120deg, var(--surface-2), var(--surface-1))",
  },
  {
    id: "sunroom",
    label: "Sunroom",
    group: "illustration",
    background:
      "radial-gradient(ellipse at 80% 50%, color-mix(in oklab, var(--accent) 24%, var(--surface-1)) 0 16%, transparent 16.5%), linear-gradient(115deg, var(--surface-1), var(--surface-2))",
  },
];

export function getQuizCoverPreset(id: string | null | undefined) {
  return QUIZ_COVER_PRESETS.find((preset) => preset.id === id) ?? null;
}

export type QuizCoverCredit = Pick<QuizCoverMeta, "photographer" | "photographerUrl" | "photoUrl">;
