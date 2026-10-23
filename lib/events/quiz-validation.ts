export type QuizOptionInput = {
  label: string;
  description: string;
  imageSource: "none" | "blob" | "external_url";
  imageUrl: string;
  imageBlobKey: string;
  imageAlt: string;
};

export type QuizQuestionInput = {
  prompt: string;
  description: string;
  pickType: "single" | "top_n";
  maxPicks: number;
  options: QuizOptionInput[];
};

export type QuizQuestionsValidation = {
  errors: Record<string, string>;
  questions: QuizQuestionInput[];
};

function isBlankOption(option: QuizOptionInput) {
  return (
    option.label.trim() === "" &&
    option.description.trim() === "" &&
    option.imageUrl.trim() === "" &&
    option.imageBlobKey.trim() === ""
  );
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isOptionInput(value: unknown): value is QuizOptionInput {
  if (!value || typeof value !== "object") return false;
  const option = value as Record<string, unknown>;
  return (
    typeof option.label === "string" &&
    typeof option.description === "string" &&
    typeof option.imageUrl === "string" &&
    typeof option.imageBlobKey === "string" &&
    typeof option.imageAlt === "string" &&
    (option.imageSource === "none" ||
      option.imageSource === "blob" ||
      option.imageSource === "external_url")
  );
}

export function validateQuizQuestions(
  rawQuestions: unknown,
  strict: boolean,
): QuizQuestionsValidation {
  const errors: Record<string, string> = {};
  if (!Array.isArray(rawQuestions) || rawQuestions.length < 1 || rawQuestions.length > 20) {
    return {
      errors: { questions: "A poll needs between 1 and 20 questions." },
      questions: [],
    };
  }

  const questions: QuizQuestionInput[] = [];
  rawQuestions.forEach((rawQuestion, questionIndex) => {
    const prefix = `question-${questionIndex}`;
    if (!rawQuestion || typeof rawQuestion !== "object") {
      errors[`${prefix}-prompt`] = "This question is invalid.";
      return;
    }
    const question = rawQuestion as Record<string, unknown>;
    if (
      typeof question.prompt !== "string" ||
      typeof question.description !== "string" ||
      (question.pickType !== "single" && question.pickType !== "top_n") ||
      !Number.isInteger(question.maxPicks) ||
      !Array.isArray(question.options) ||
      question.options.some((option) => !isOptionInput(option))
    ) {
      errors[`${prefix}-prompt`] = "This question contains invalid fields.";
      return;
    }

    const rawOptions = question.options as QuizOptionInput[];
    const normalizedQuestion: QuizQuestionInput = {
      prompt: question.prompt.trim(),
      description: question.description.trim(),
      pickType: question.pickType,
      maxPicks: question.maxPicks as number,
      options: rawOptions.filter((option) => !isBlankOption(option)),
    };
    questions.push(normalizedQuestion);

    if (normalizedQuestion.prompt.length > 500) {
      errors[`${prefix}-prompt`] = "Keep question prompts to 500 characters or fewer.";
    }
    if (normalizedQuestion.description.length > 2000) {
      errors[`${prefix}-description`] = "Keep question descriptions to 2000 characters or fewer.";
    }
    if (strict) {
      if (normalizedQuestion.prompt.length < 1 || normalizedQuestion.prompt.length > 500) {
        errors[`${prefix}-prompt`] = "Give this question a prompt (500 characters maximum).";
      }
      if (normalizedQuestion.options.length < 2) {
        errors[`${prefix}-options`] = "Add at least two options to every question.";
      }
    }
    if (rawOptions.length > 8) {
      errors[`${prefix}-options`] = "A question can have at most eight options.";
    }

    normalizedQuestion.options.forEach((option, optionIndex) => {
      const optionPrefix = `${prefix}-option-${optionIndex}`;
      if (option.label.trim().length === 0) {
        errors[`${optionPrefix}-label`] = "Give this option a label or clear the row.";
      } else if (option.label.trim().length > 120) {
        errors[`${optionPrefix}-label`] = "Keep option labels to 120 characters or fewer.";
      }
      if (option.description.trim().length > 1000) {
        errors[`${optionPrefix}-description`] = "Keep option descriptions to 1000 characters or fewer.";
      }
      if (option.imageAlt.trim().length > 180) {
        errors[`${optionPrefix}-image-alt`] = "Keep image alt text to 180 characters or fewer.";
      }
      if (option.imageSource === "external_url" && !validHttpUrl(option.imageUrl)) {
        errors[`${optionPrefix}-image`] = "Paste a valid http(s) image URL.";
      }
      if (option.imageSource === "blob" &&
        (!validHttpUrl(option.imageUrl) || option.imageBlobKey.trim() === "")) {
        errors[`${optionPrefix}-image`] = "This upload looks incomplete — try uploading again.";
      }
    });

    if (normalizedQuestion.pickType === "single" && normalizedQuestion.maxPicks !== 1) {
      errors[`${prefix}-max-picks`] = "Pick one questions must use exactly one pick.";
    }
    if (normalizedQuestion.pickType === "top_n") {
      if (normalizedQuestion.maxPicks < 2 || normalizedQuestion.maxPicks > 8) {
        errors[`${prefix}-max-picks`] = "Pick top N must rank between 2 and 8 options.";
      } else if (
        strict &&
        normalizedQuestion.maxPicks > normalizedQuestion.options.filter((option) => option.label.trim()).length
      ) {
        errors[`${prefix}-max-picks`] = "The rank limit cannot exceed this question’s labeled options.";
      }
    }
  });

  return { errors, questions };
}
