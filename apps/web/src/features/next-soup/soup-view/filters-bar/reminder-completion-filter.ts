import { batch } from 'solid-js';
import type { SetPredicatesInput } from '../../filters/filter-store/predicates-store';
import type { QueryStore } from '../../filters/filter-store/query-store';

type CompletionPredicates = {
  andIds: () => readonly string[];
  orIds: () => readonly string[];
  set: (input: SetPredicatesInput<string>) => void;
};
const isCompletion = (id: string) =>
  id === 'reminders-done' || id === 'reminders-not-done';

/** A scalar server filter must have one matching client selection. */
export function toggleReminderCompletionFilter(
  optionId: string,
  predicates: CompletionPredicates,
  query: Pick<QueryStore, 'state' | 'set'>
): boolean {
  if (!isCompletion(optionId)) return false;
  const requested = optionId === 'reminders-done';
  const completed =
    query.state.include.reminderCompleted === requested ? undefined : requested;
  batch(() => {
    predicates.set({
      and: [
        ...predicates.andIds().filter((id) => !isCompletion(id)),
        ...(completed === undefined ? [] : [optionId]),
      ],
      or: predicates.orIds().filter((id) => !isCompletion(id)),
    });
    query.set({ include: { reminderCompleted: completed } });
  });
  return true;
}
