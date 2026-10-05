/**
 * `/poll` (RFC 03 §3): a poll is a form with one required choice question.
 * Create the form (and its database), add the Select column with the options
 * under ids minted here, place it as the only question, and set whether
 * respondents see the results.
 */
import { createDatabaseColumn } from '@block-database/queries/columns';
import { createForm, putFormLayout, updateForm } from '@queries/storage/forms';
import { err, errAsync, ResultAsync } from 'neverthrow';
import { v7 as uuidv7 } from 'uuid';
import type { FormWriteFailure } from '../context/form-context';
import { columnWriteFailure } from './column-writes';
import { writeFailureOf } from './form-sources';

export type PollDraft = {
  question: string;
  options: string[];
  multi: boolean;
  showResults: boolean;
};

/** A poll draft's options, trimmed, blank ones dropped, each label once. */
export function pollOptions(options: readonly string[]): string[] {
  const seen = new Set<string>();
  return options.flatMap((option) => {
    const label = option.trim();
    if (!label || seen.has(label.toLowerCase())) return [];
    seen.add(label.toLowerCase());
    return [label];
  });
}

/** What a half-made poll leaves behind, for the caller to put in the trash. */
export type MadePoll = { formId: string; databaseId: string };

export function publishPoll(
  draft: PollDraft,
  discard: (made: MadePoll) => ResultAsync<void, unknown>
): ResultAsync<MadePoll & { name: string }, FormWriteFailure> {
  const question = draft.question.trim();
  const labels = pollOptions(draft.options);
  if (!question) return errAsync({ message: 'Ask a question.' });
  if (labels.length < 2)
    return errAsync({ message: 'Give at least two options.' });
  return createForm({ name: question, source: { kind: 'new' } }, 'poll')
    .mapErr(writeFailureOf)
    .andThen((detail) => {
      const { databaseId, tableId, id: formId } = detail.form;
      // A step refused after the form exists leaves nothing behind in Drive.
      const abandon = (failure: FormWriteFailure) =>
        new ResultAsync<never, FormWriteFailure>(
          discard({ formId, databaseId }).match(
            () => err(failure),
            () =>
              err({
                ...failure,
                message: `${failure.message} The unfinished poll is still in Drive.`,
              })
          )
        );
      const section = detail.sections.find((item) => item.kind === 'questions');
      if (!section)
        return abandon({
          message: 'The new form has no section to hold the question.',
        });
      return createDatabaseColumn({
        databaseId,
        tableId,
        name: 'Answer',
        type: { type: 'select', multi: draft.multi },
        options: labels,
      })
        .mapErr(columnWriteFailure)
        .andThen((columnId) =>
          putFormLayout(formId, {
            sections: [
              {
                kind: 'questions',
                id: section.id,
                title: '',
                description: '',
                questions: [
                  {
                    id: uuidv7(),
                    column: columnId,
                    helpText: '',
                    required: true,
                    widget: draft.multi ? 'checkboxes' : 'choice',
                  },
                ],
              },
            ],
          }).mapErr(writeFailureOf)
        )
        .andThen(() =>
          updateForm(formId, { tallyVisible: draft.showResults }).mapErr(
            writeFailureOf
          )
        )
        .orElse(abandon)
        .map(() => ({ formId, databaseId, name: question }));
    });
}
