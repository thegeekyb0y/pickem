import { describe, expect, it } from "vitest";
import { validateQuizQuestions, type QuizQuestionInput } from "@/lib/events/quiz-validation";

function option(label: string) {
  return {
    label,
    description: "",
    imageSource: "none" as const,
    imageUrl: "",
    imageBlobKey: "",
    imageAlt: "",
  };
}

function question(overrides: Partial<QuizQuestionInput> = {}): QuizQuestionInput {
  return {
    prompt: "Choose an answer",
    description: "",
    pickType: "single",
    maxPicks: 1,
    options: [option("First"), option("Second")],
    ...overrides,
  };
}

describe("validateQuizQuestions", () => {
  it("validates each question's own pick type and rank limit", () => {
    const result = validateQuizQuestions([
      question(),
      question({
        prompt: "Rank these choices",
        pickType: "top_n",
        maxPicks: 3,
        options: [option("One"), option("Two"), option("Three")],
      }),
    ], true);

    expect(result.errors).toEqual({});
    expect(result.questions.map((item) => item.pickType)).toEqual(["single", "top_n"]);
  });

  it("requires at least one question and caps a quiz at twenty", () => {
    expect(validateQuizQuestions([], true).errors.questions).toMatch(/1 and 20/);
    expect(validateQuizQuestions(Array.from({ length: 21 }, () => question()), true).errors.questions)
      .toMatch(/1 and 20/);
  });

  it("requires a prompt and two to eight labeled options on publish", () => {
    const result = validateQuizQuestions([
      question({ prompt: "", options: [option("Only one")] }),
    ], true);

    expect(result.errors["question-0-prompt"]).toBeTruthy();
    expect(result.errors["question-0-options"]).toBeTruthy();
  });

  it("rejects a Pick top N limit larger than its labeled options", () => {
    const result = validateQuizQuestions([
      question({
        pickType: "top_n",
        maxPicks: 3,
        options: [option("One"), option("Two")],
      }),
    ], true);

    expect(result.errors["question-0-max-picks"]).toMatch(/cannot exceed/);
  });

  it("keeps incomplete question drafts but never accepts more than eight option rows", () => {
    const draft = validateQuizQuestions([
      question({ prompt: "", options: [] }),
    ], false);
    expect(draft.errors).toEqual({});

    const overLimit = validateQuizQuestions([
      question({ options: Array.from({ length: 9 }, (_, index) => option(`Option ${index}`)) }),
    ], false);
    expect(overLimit.errors["question-0-options"]).toMatch(/at most eight/);
  });
});
