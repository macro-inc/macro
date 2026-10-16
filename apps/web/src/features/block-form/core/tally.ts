import type { FormColumn, FormDetail, FormQuestion } from './form-model';

/** A poll: a form with exactly one choice question whose results respondents may see. */
export type Poll = {
  question: FormQuestion;
  column: FormColumn;
  multi: boolean;
};

/** The form as a poll, when it is one (RFC 03 §3). */
export function pollOf(detail: FormDetail): Poll | undefined {
  if (!detail.form.tallyVisible) return undefined;
  const questions = detail.layout.sections.flatMap(
    (section) => section.questions
  );
  if (questions.length !== 1) return undefined;
  const [question] = questions;
  const column = detail.columns.find((item) => item.id === question.columnId);
  if (!column || column.kind.type !== 'select') return undefined;
  return { question, column, multi: column.kind.multi };
}

export type PollBar = {
  optionId: string;
  label: string;
  count: number;
  /** Share of the votes, 0–100, rounded. */
  percent: number;
  mine: boolean;
};

/** One bar per option, in option order, zero counts included. */
export function pollBars(
  poll: Poll,
  counts: ReadonlyMap<string, number> | undefined,
  responses: number,
  mine: readonly string[]
): PollBar[] {
  return poll.column.options.map((option) => {
    const count = counts?.get(option.id) ?? 0;
    return {
      optionId: option.id,
      label: option.label,
      count,
      percent: responses > 0 ? Math.round((count / responses) * 100) : 0,
      mine: mine.includes(option.id),
    };
  });
}

/** "19 votes · one vote each" or "4 votes · multiple answers". */
export function pollSummary(responses: number, multi: boolean): string {
  const votes = responses === 1 ? '1 vote' : `${responses} votes`;
  return `${votes} · ${multi ? 'multiple answers' : 'one vote each'}`;
}
