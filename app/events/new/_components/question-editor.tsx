"use client";

import { useState } from "react";
import Image from "next/image";
import { Reorder, useDragControls } from "motion/react";
import { ChevronDown, ChevronUp, Copy, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputField, InputGroup } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { spring } from "@/lib/springs";
import { uploadOptionImage } from "@/lib/events/actions";
import type { QuizQuestionInput } from "@/lib/events/quiz-validation";

export type QuizOptionState = QuizQuestionInput["options"][number] & {
  key: string;
  showImage: boolean;
  imageMode: "upload" | "link";
  uploading: boolean;
  imageError: string | null;
  linkDraft: string;
};

export type QuizQuestionState = Omit<QuizQuestionInput, "options"> & {
  key: string;
  options: QuizOptionState[];
};

function validHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function OptionEditor({
  option,
  questionIndex,
  optionIndex,
  canRemove,
  remove,
  update,
  errors,
}: {
  option: QuizOptionState;
  questionIndex: number;
  optionIndex: number;
  canRemove: boolean;
  update: (patch: Partial<QuizOptionState>) => void;
  remove: () => void;
  errors: Record<string, string>;
}) {
  const prefix = `question-${questionIndex}-option-${optionIndex}`;

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    update({ uploading: true, imageError: null });
    const formData = new FormData();
    formData.set("file", file);
    const result = await uploadOptionImage(formData);
    if (result.ok) {
      update({
        uploading: false,
        imageUrl: result.url,
        imageBlobKey: result.key,
        imageSource: "blob",
        imageMode: "upload",
      });
    } else {
      update({ uploading: false, imageError: result.error });
    }
  }

  function attachLink() {
    if (!validHttpUrl(option.linkDraft)) {
      update({ imageError: "Paste a valid http(s) image URL." });
      return;
    }
    update({
      imageError: null,
      imageSource: "external_url",
      imageUrl: option.linkDraft.trim(),
      imageBlobKey: "",
      imageMode: "link",
    });
  }

  return (
    <li className="rounded-lg border border-border bg-surface-1 p-2.5 sm:p-3">
      <div className="flex items-start justify-between gap-3">
        <InputGroup className="font-fluid w-full max-w-none">
          <InputField
            id={`${prefix}-label`}
            name={`${prefix}-label`}
            label={`Option ${optionIndex + 1}`}
            index={0}
            value={option.label}
            onChange={(label) => update({ label })}
            maxLength={120}
            placeholder="Add an answer choice"
            error={errors[`${prefix}-label`]}
          />
        </InputGroup>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove option ${optionIndex + 1}`}
          disabled={!canRemove}
          onClick={remove}
          className="font-fluid mt-5 min-h-11 min-w-11 shrink-0"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Switch
          label="Add image"
          checked={option.showImage}
          onToggle={() => update({ showImage: !option.showImage })}
        />
      </div>

      {option.showImage ? (
        <div className="mt-3 space-y-3">
          <div className="max-w-sm">
            <label htmlFor={`${prefix}-image-source`} className="mb-1 block text-sm font-medium">
              Image source
            </label>
            <Select
              value={option.imageMode}
              onValueChange={(value) => {
                if (value === "link") {
                  update({
                    imageMode: value,
                    imageSource: option.linkDraft.trim() ? "external_url" : "none",
                    imageUrl: option.linkDraft.trim(),
                    imageBlobKey: "",
                  });
                } else if (value === "upload") {
                  const keepUpload = option.imageSource === "blob";
                  update({
                    imageMode: value,
                    imageSource: keepUpload ? "blob" : "none",
                    imageUrl: keepUpload ? option.imageUrl : "",
                    imageBlobKey: keepUpload ? option.imageBlobKey : "",
                  });
                }
              }}
            >
              <SelectTrigger
                id={`${prefix}-image-source`}
                className="font-fluid min-h-11 w-full"
                placeholder="Choose image source"
              />
              <SelectContent>
                <SelectItem index={0} value="upload">
                  Upload image
                </SelectItem>
                <SelectItem index={1} value="link">
                  Paste image URL
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {option.imageMode === "upload" ? (
            <p className="mt-2">
              <label htmlFor={`${prefix}-file`} className="mb-1 block text-sm font-medium">
                Choose option image
              </label>
              <input
                id={`${prefix}-file`}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={option.uploading}
                onChange={(event) => {
                  void chooseFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
                className="block w-full text-sm text-foreground file:mr-3 file:min-h-11 file:rounded-md file:border file:border-border file:bg-surface-1 file:px-3 file:font-medium file:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                PNG, JPEG, or WebP, under 4 MB.
              </span>
            </p>
          ) : (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label htmlFor={`${prefix}-url`} className="mb-1 block text-sm font-medium">
                  Option image URL
                </label>
                <input
                  id={`${prefix}-url`}
                  type="url"
                  inputMode="url"
                  value={option.linkDraft}
                  placeholder="https://…"
                  onChange={(event) => update({ linkDraft: event.target.value, imageError: null })}
                  aria-invalid={Boolean(errors[`${prefix}-image`] || option.imageError)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={attachLink}
                className="font-fluid min-h-11 px-4"
              >
                Attach
              </Button>
            </div>
          )}
          {option.imageError || errors[`${prefix}-image`] ? (
            <p role="alert" className="text-sm text-accent">{option.imageError ?? errors[`${prefix}-image`]}</p>
          ) : null}
          {option.imageUrl ? (
            <div className="flex items-center gap-3">
              <Image
                src={option.imageUrl}
                alt={option.imageAlt || ""}
                width={48}
                height={48}
                unoptimized
                className="size-12 shrink-0 rounded-md border border-border object-cover"
              />
              <InputGroup className="font-fluid min-w-0 flex-1">
                <InputField
                  id={`${prefix}-alt`}
                  label="Image alt text"
                  index={0}
                  value={option.imageAlt}
                  onChange={(imageAlt) => update({ imageAlt })}
                  maxLength={180}
                  placeholder="Describe the image"
                  error={errors[`${prefix}-image-alt`]}
                />
              </InputGroup>
              <Button
                type="button"
                variant="ghost"
                size="compact"
                className="font-fluid min-h-10 px-3"
                onClick={() => update({ imageUrl: "", imageBlobKey: "", imageAlt: "", linkDraft: "" })}
              >
                Remove image
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function QuestionCard({
  question,
  index,
  count,
  errors,
  update,
  move,
  duplicate,
  requestDelete,
  requestOptionDelete,
}: {
  question: QuizQuestionState;
  index: number;
  count: number;
  errors: Record<string, string>;
  update: (patch: Partial<QuizQuestionState>) => void;
  move: (direction: -1 | 1) => void;
  duplicate: () => void;
  requestDelete: () => void;
  requestOptionDelete: (optionKey: string) => void;
}) {
  const dragControls = useDragControls();
  const questionPrefix = `question-${index}`;

  function updateOption(key: string, patch: Partial<QuizOptionState>) {
    update({
      options: question.options.map((option) =>
        option.key === key ? { ...option, ...patch } : option,
      ),
    });
  }

  function removeOption(key: string) {
    if (question.options.length <= 1) return;
    const option = question.options.find((item) => item.key === key);
    if (!option) return;
    const hasContent = option.label.trim() || option.description.trim() || option.imageUrl.trim();
    if (hasContent) {
      requestOptionDelete(key);
      return;
    }
    update({ options: question.options.filter((item) => item.key !== key) });
  }

  return (
    <Reorder.Item
      as="li"
      value={question.key}
      dragListener={false}
      dragControls={dragControls}
      transition={spring.moderate}
      className="relative rounded-xl border border-border bg-surface-1 p-3 sm:p-4"
      aria-labelledby={`${questionPrefix}-heading`}
    >
      <div className="flex items-start gap-2">
        <div className="flex shrink-0 flex-col gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Drag to reorder question ${index + 1}`}
            onPointerDown={(event) => dragControls.start(event.nativeEvent)}
            className="font-fluid min-h-11 min-w-11 touch-none"
          >
            <GripVertical aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-compact"
            aria-label={`Move question ${index + 1} up`}
            disabled={index === 0}
            onClick={() => move(-1)}
            className="font-fluid min-h-10 min-w-10"
          >
            <ChevronUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-compact"
            aria-label={`Move question ${index + 1} down`}
            disabled={index === count - 1}
            onClick={() => move(1)}
            className="font-fluid min-h-10 min-w-10"
          >
            <ChevronDown aria-hidden="true" />
          </Button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge size="compact" color="gray">Question {index + 1}</Badge>
              <Badge size="compact" variant="dot" color="amber">Required</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="compact"
                leadingIcon={Copy}
                onClick={duplicate}
                disabled={count >= 20}
                className="font-fluid min-h-10 px-3"
              >
                Duplicate
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="compact"
                leadingIcon={Trash2}
                onClick={requestDelete}
                disabled={count <= 1}
                className="font-fluid min-h-10 px-3 text-accent"
              >
                Delete
              </Button>
            </div>
          </div>

          <h2 id={`${questionPrefix}-heading`} className="sr-only">Question {index + 1}</h2>
          <div className="mt-3">
            <InputGroup className="font-fluid w-full max-w-none">
              <InputField
                id={`${questionPrefix}-prompt`}
                label="Question"
                index={0}
                value={question.prompt}
                onChange={(prompt) => update({ prompt })}
                maxLength={500}
                placeholder="Type your question"
                error={errors[`${questionPrefix}-prompt`]}
              />
            </InputGroup>
          </div>

          <div className="mt-3">
            <Select
              value={question.pickType}
              onValueChange={(value) => {
                if (value !== "single" && value !== "top_n") return;
                update({ pickType: value, maxPicks: value === "single" ? 1 : Math.max(2, question.maxPicks) });
              }}
            >
              <label htmlFor={`${questionPrefix}-pick-type`} className="mb-1 block text-sm font-medium">
                Answer format
              </label>
              <SelectTrigger id={`${questionPrefix}-pick-type`} className="font-fluid min-h-11 w-full max-w-sm" />
              <SelectContent>
                <SelectItem index={0} value="single">Pick one — choose one answer</SelectItem>
                <SelectItem index={1} value="top_n">Pick top N — rank answers</SelectItem>
              </SelectContent>
            </Select>
            {question.pickType === "top_n" ? (
              <div className="mt-2 max-w-xs">
                <label htmlFor={`${questionPrefix}-max-picks`} className="mb-1 block text-sm font-medium">
                  Rank limit
                </label>
                <Select
                  value={String(question.maxPicks)}
                  onValueChange={(value) => update({ maxPicks: Number(value) })}
                  name={`${questionPrefix}-max-picks`}
                >
                  <SelectTrigger
                    id={`${questionPrefix}-max-picks`}
                    placeholder="Choose rank limit"
                    className="font-fluid min-h-11 w-full"
                    error={errors[`${questionPrefix}-max-picks`]}
                  />
                  <SelectContent>
                    {Array.from({ length: 7 }, (_, position) => position + 2).map((limit, itemIndex) => (
                      <SelectItem key={limit} index={itemIndex} value={String(limit)}>
                        Rank up to {limit} options
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">Voters may rank fewer, but must choose at least one.</p>
              </div>
            ) : null}
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-foreground">Answer options</h3>
              <p className="font-mono text-xs tabular-nums text-muted-foreground">
                {question.options.filter((option) => option.label.trim()).length} labeled · 2–8 options
              </p>
            </div>
            {errors[`${questionPrefix}-options`] ? (
              <p role="alert" className="mt-2 text-sm text-accent">{errors[`${questionPrefix}-options`]}</p>
            ) : null}
            <ul className="mt-2 space-y-2" aria-label={`Answer options for question ${index + 1}`}>
              {question.options.map((option, optionIndex) => (
                <OptionEditor
                  key={option.key}
                  option={option}
                  questionIndex={index}
                  optionIndex={optionIndex}
                  canRemove={question.options.length > 1}
                  update={(patch) => updateOption(option.key, patch)}
                  remove={() => removeOption(option.key)}
                  errors={errors}
                />
              ))}
            </ul>
            <Button
              type="button"
              variant="secondary"
              disabled={question.options.length >= 8}
              onClick={() => update({ options: [...question.options, blankOption()] })}
              className="font-fluid mt-3 min-h-11 w-full justify-center border border-dashed border-border bg-transparent sm:w-auto"
            >
              Add option
            </Button>
          </div>
        </div>
      </div>
    </Reorder.Item>
  );
}

export default function QuestionEditor({
  questions,
  errors,
  onChange,
}: {
  questions: QuizQuestionState[];
  errors: Record<string, string>;
  onChange: (questions: QuizQuestionState[]) => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "question"; questionKey: string }
    | { kind: "option"; questionKey: string; optionKey: string }
    | null
  >(null);

  function updateQuestion(questionKey: string, patch: Partial<QuizQuestionState>) {
    onChange(questions.map((question) =>
      question.key === questionKey ? { ...question, ...patch } : question,
    ));
  }

  function moveQuestion(questionKey: string, direction: -1 | 1) {
    const index = questions.findIndex((question) => question.key === questionKey);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function duplicateQuestion(questionKey: string) {
    if (questions.length >= 20) return;
    const index = questions.findIndex((question) => question.key === questionKey);
    if (index < 0) return;
    const duplicate = cloneQuestion(questions[index]);
    const next = [...questions];
    next.splice(index + 1, 0, duplicate);
    onChange(next);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "question") {
      if (questions.length > 1) {
        onChange(questions.filter((question) => question.key !== pendingDelete.questionKey));
      }
    } else {
      onChange(questions.map((question) =>
        question.key === pendingDelete.questionKey
          ? { ...question, options: question.options.filter((option) => option.key !== pendingDelete.optionKey) }
          : question,
      ));
    }
    setPendingDelete(null);
  }

  const questionKeys = questions.map((question) => question.key);

  return (
    <>
      <Reorder.Group
        as="ol"
        axis="y"
        values={questionKeys}
        onReorder={(order) => {
          const byKey = new Map(questions.map((question) => [question.key, question]));
          onChange(order.flatMap((key) => {
            const question = byKey.get(key);
            return question ? [question] : [];
          }));
        }}
        className="m-0 list-none space-y-3 p-0"
        aria-label="Poll questions"
      >
        {questions.map((question, index) => (
          <QuestionCard
            key={question.key}
            question={question}
            index={index}
            count={questions.length}
            errors={errors}
            update={(patch) => updateQuestion(question.key, patch)}
            move={(direction) => moveQuestion(question.key, direction)}
            duplicate={() => duplicateQuestion(question.key)}
            requestDelete={() => setPendingDelete({ kind: "question", questionKey: question.key })}
            requestOptionDelete={(optionKey) => setPendingDelete({ kind: "option", questionKey: question.key, optionKey })}
          />
        ))}
      </Reorder.Group>

      <Button
        type="button"
        variant="secondary"
        disabled={questions.length >= 20}
        onClick={() => onChange([...questions, blankQuestion()])}
        className="font-fluid mt-4 min-h-12 w-full justify-center border border-dashed border-border bg-surface-1 sm:w-auto"
      >
        + Add question
      </Button>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent size="sm" aria-describedby="question-delete-description">
          <DialogHeader>
            <DialogTitle>
              {pendingDelete?.kind === "question" ? "Delete this question?" : "Delete this answer option?"}
            </DialogTitle>
            <DialogDescription id="question-delete-description">
              This change removes the selected content from the poll draft.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" className="font-fluid min-h-11 px-4">Cancel</Button>} />
            <Button type="button" variant="primary" onClick={confirmDelete} className="font-fluid min-h-11 px-4">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function blankOption(): QuizOptionState {
  return {
    key: crypto.randomUUID(),
    label: "",
    description: "",
    imageSource: "none",
    imageUrl: "",
    imageBlobKey: "",
    imageAlt: "",
    showImage: false,
    imageMode: "upload",
    uploading: false,
    imageError: null,
    linkDraft: "",
  };
}

export function blankQuestion(): QuizQuestionState {
  return {
    key: crypto.randomUUID(),
    prompt: "",
    description: "",
    pickType: "single",
    maxPicks: 1,
    options: [blankOption(), blankOption()],
  };
}

function cloneQuestion(question: QuizQuestionState): QuizQuestionState {
  return {
    ...question,
    key: crypto.randomUUID(),
    options: question.options.map((option) => ({ ...option, key: crypto.randomUUID() })),
  };
}
