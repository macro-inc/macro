import { match } from 'ts-pattern';
import { brokenGateColumns } from './form-layout';
import type {
  FormAnswers,
  FormCellValue,
  FormColumn,
  FormLayout,
  FormQuestion,
  FormSection,
} from './form-model';
import { gatePasses, presentValue } from './gate-evaluation';

/** One answer as a submission carries it. */
export type SubmittedAnswer = { question: string; value: FormCellValue };

export type AnswerProblem = { questionId: string; message: string };

/** Whether a value holds something; `clear`, empty text and empty lists do not. */
export function isAnswered(
  value: FormCellValue | undefined
): value is FormCellValue {
  return presentValue(value) !== undefined;
}

function isWebUrl(text: string) {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** What is wrong with one answer, if anything: required, then basic shape. */
export function answerProblem(
  question: FormQuestion,
  column: FormColumn,
  value: FormCellValue | undefined,
  mode: 'response' | 'preview' = 'response'
): string | undefined {
  if (!isAnswered(value)) {
    return question.required ? 'This question is required.' : undefined;
  }
  const single = match(column.kind)
    .with(
      { type: 'select' },
      { type: 'select_number' },
      { type: 'entity' },
      ({ multi }) => !multi
    )
    .with({ type: 'link' }, () => true)
    .with(
      { type: 'text' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'date' },
      { type: 'tag' },
      { type: 'relation' },
      () => false
    )
    .exhaustive();
  return match(value)
    .with({ type: 'number' }, ({ value: number }) =>
      Number.isFinite(number) ? undefined : 'Enter a number.'
    )
    .with({ type: 'date' }, ({ value: date }) =>
      Number.isNaN(Date.parse(date)) ? 'Enter a valid date.' : undefined
    )
    .with({ type: 'link' }, ({ value: links }) => {
      if (single && links.length > 1) return 'Give one link.';
      return links.every(
        (link) =>
          isWebUrl(link) ||
          (mode === 'preview' &&
            question.widget === 'file' &&
            link.startsWith('blob:'))
      )
        ? undefined
        : 'Enter a full link starting with https://';
    })
    .with({ type: 'options' }, ({ value: references }) => {
      if (single && references.length > 1) return 'Choose one option.';
      const known = new Set(column.options.map((option) => option.id));
      return references.every(
        (reference) => 'id' in reference && known.has(reference.id)
      )
        ? undefined
        : 'That option is no longer available.';
    })
    .with({ type: 'entities' }, ({ value: references }) =>
      single && references.length > 1 ? 'Choose one.' : undefined
    )
    .with(
      { type: 'text' },
      { type: 'boolean' },
      { type: 'rows' },
      { type: 'clear' },
      () => undefined
    )
    .exhaustive();
}

/** Every problem with a section's answers, in question order. */
export function sectionProblems(
  section: FormSection,
  columns: ReadonlyMap<string, FormColumn>,
  answers: FormAnswers,
  mode: 'response' | 'preview' = 'response'
): AnswerProblem[] {
  return section.questions.flatMap((question) => {
    const column = columns.get(question.columnId);
    if (!column) return [];
    const message = answerProblem(question, column, answers[question.id], mode);
    return message ? [{ questionId: question.id, message }] : [];
  });
}

/** Answers by the column each question writes, as gates read them. */
export function answersByColumn(
  layout: FormLayout,
  answers: FormAnswers
): Map<string, FormCellValue> {
  // Exactly what a submission would carry, so a local gate check agrees
  // with the server's.
  const byColumn = new Map<string, FormCellValue>();
  for (const section of layout.sections)
    for (const question of section.questions) {
      const value = answers[question.id];
      if (isAnswered(value)) byColumn.set(question.columnId, trimmed(value));
    }
  return byColumn;
}

/** Where a respondent goes from a section (or from the start, `-1`). */
export type FormStep =
  | { kind: 'section'; index: number }
  | { kind: 'stop'; sectionId: string; message: string }
  /** A gate tests a question no longer before it: the form is mid-edit. */
  | { kind: 'updating' }
  | { kind: 'submit' };

/**
 * The next questions section after `from`, evaluating every gate passed on
 * the way. A failing gate stops the respondent there.
 */
export function nextStep(
  layout: FormLayout,
  from: number,
  answers: FormAnswers
): FormStep {
  const byColumn = answersByColumn(layout, answers);
  for (let index = from + 1; index < layout.sections.length; index++) {
    const section = layout.sections[index];
    const step = match(section.kind)
      .returnType<FormStep | undefined>()
      .with('questions', () => ({ kind: 'section', index }))
      .with('gate', () => {
        if (brokenGateColumns(layout, section.id).length > 0)
          return { kind: 'updating' };
        if (section.gateRules && !gatePasses(section.gateRules, byColumn))
          return {
            kind: 'stop',
            sectionId: section.id,
            message: section.gateMessage,
          };
        return undefined;
      })
      // Unlocked by the server once the response is saved, never before.
      .with('booking', () => ({ kind: 'submit' }))
      .exhaustive();
    if (step) return step;
  }
  return { kind: 'submit' };
}

/** Whether submitting leads on to a booking step. */
export function endsWithBooking(layout: FormLayout): boolean {
  return layout.sections.some((section) => section.kind === 'booking');
}

/** The questions section before `from`, if any. */
export function previousSectionIndex(
  layout: FormLayout,
  from: number
): number | undefined {
  for (let index = from - 1; index >= 0; index--)
    if (layout.sections[index].kind === 'questions') return index;
  return undefined;
}

/** The questions sections, in order, as indices of the layout. */
export function questionSectionIndices(layout: FormLayout): number[] {
  return layout.sections.flatMap((section, index) =>
    section.kind === 'questions' ? [index] : []
  );
}

/**
 * The answers to send. A first submission carries what was answered; an edit
 * carries every question, clearing the ones emptied since.
 */
export function submissionAnswers(
  layout: FormLayout,
  answers: FormAnswers,
  mode: 'create' | 'edit'
): SubmittedAnswer[] {
  return layout.sections.flatMap((section) =>
    section.questions.flatMap((question): SubmittedAnswer[] => {
      const value = answers[question.id];
      if (isAnswered(value))
        return [{ question: question.id, value: trimmed(value) }];
      return mode === 'edit'
        ? [{ question: question.id, value: { type: 'clear' } }]
        : [];
    })
  );
}

function trimmed(value: FormCellValue): FormCellValue {
  return value.type === 'text'
    ? { type: 'text', value: value.value.trim() }
    : value;
}

/** Answers kept in memory, from a stored response. */
export function answersOf(submitted: readonly SubmittedAnswer[]): FormAnswers {
  const answers: FormAnswers = {};
  for (const { question, value } of submitted)
    if (isAnswered(value)) answers[question] = value;
  return answers;
}
