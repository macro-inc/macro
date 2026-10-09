import type { FormCollaboration } from '@service-storage/generated/schemas/formCollaboration';
import { match } from 'ts-pattern';

/** Turn publication problems into builder copy without exposing storage IDs. */
export function publicationMessage(
  result: FormCollaboration
): string | undefined {
  const problem = result.publicationError;
  if (!problem) return undefined;
  const questions = result.detail.sections.flatMap((section) =>
    section.kind === 'questions' ? section.questions : []
  );
  const columnName = (column: string) => {
    const title = questions.find(
      (question) => question.column === column
    )?.title;
    return title ? `“${title}”` : 'That question';
  };
  return match(problem)
    .with(
      { kind: 'invalidDraft' },
      () =>
        'This draft couldn’t be read. Your published form is still available.'
    )
    .with(
      { kind: 'pending' },
      () => 'Your draft is saved. Publishing hasn’t finished; try again.'
    )
    .with(
      { kind: 'fileUploadNeedsSignIn' },
      () =>
        'File uploads require signed-in respondents. Change the audience or remove the file question.'
    )
    .with({ kind: 'widgetMismatch' }, ({ question }) => {
      const title = questions.find((item) => item.id === question)?.title;
      return `${title ? `“${title}”` : 'A question'} changed type. Choose a matching answer format.`;
    })
    .with({ kind: 'layout' }, ({ problem }) =>
      match(problem)
        .with(
          { kind: 'bookingMustBeLast' },
          () => 'Keep one booking step after all questions and screeners.'
        )
        .with(
          { kind: 'unknownColumn' },
          ({ column }) =>
            `${columnName(column)} was deleted. Remove it from this form.`
        )
        .with(
          { kind: 'managedColumn' },
          ({ column }) =>
            `${columnName(column)} is filled in automatically. Remove it from this form.`
        )
        .with(
          { kind: 'repeatedColumn' },
          ({ column }) =>
            `${columnName(column)} appears more than once. Remove the duplicate.`
        )
        .with(
          { kind: 'repeatedId' },
          () =>
            'A section or question was added more than once. Remove the duplicate.'
        )
        .with(
          { kind: 'gateNamesLaterColumn' },
          ({ column }) =>
            `${columnName(column)} must come before the screener that checks it.`
        )
        .with(
          { kind: 'gateRule' },
          () =>
            'Review your screener rules; one no longer matches its question.'
        )
        .with(
          { kind: 'textTooLong' },
          ({ max }) => `Shorten the text to ${max} characters or fewer.`
        )
        .exhaustive()
    )
    .exhaustive();
}
