import { match } from 'ts-pattern';
import type { Suggestion } from './suggestion';

/** The For you page's lists, as its sidebar names them. */
export type ForYouList = 'today' | 'toDo' | 'suggestions' | 'done';

export const FOR_YOU_LISTS: readonly ForYouList[] = [
  'today',
  'toDo',
  'suggestions',
  'done',
];

/**
 * How a row reads:
 * - `open`, `running`, `failed`: it waits on the person, or Macro offers it,
 *   or its run is under way or failed, as the server says.
 * - `markedDone`: the person finished it during this visit.
 * - `finished`: its run finished during this visit.
 * - `routineOn`: its routine was saved during this visit.
 * - `done`: finished, in the Done list.
 * - `dismissed`: turned down during this visit.
 *
 * The settled ones stay where they were until the person leaves the page,
 * then they are in Done.
 */
export type RowState =
  | 'open'
  | 'running'
  | 'failed'
  | 'markedDone'
  | 'finished'
  | 'routineOn'
  | 'done'
  | 'dismissed';

/** One row in a list. */
export type FeedEntry = {
  suggestion: Suggestion;
  state: RowState;
  /** Proposed since the person last opened their feed. */
  isNew: boolean;
  /** Its action is under way. */
  busy: boolean;
  /** Its last action failed. */
  failed: boolean;
  /** It was rewritten under the row: the action took nothing up, and the row now shows the new text. */
  changed: boolean;
  /** A row the person marked done here, which Undo opens again. */
  canUndo: boolean;
};

/** How many rows wait in each list: settled and dismissed ones don't count. */
export type ListCounts = Record<ForYouList, number>;

/** Whether a row belongs in a list other than Done, by whose work it is. */
export function inList(list: ForYouList, suggestion: Suggestion): boolean {
  return match(list)
    .with('today', () => true)
    .with('toDo', () => suggestion.kind === 'entity')
    .with('suggestions', () => suggestion.kind !== 'entity')
    .with('done', () => false)
    .exhaustive();
}

/** How a suggestion that settled during the visit reads. */
export function settledState(suggestion: Suggestion): RowState {
  return match(suggestion)
    .with({ kind: 'routine' }, (): RowState => 'routineOn')
    .with(
      { kind: 'prompt' },
      (prompt): RowState =>
        prompt.runMode === 'background' ? 'finished' : 'markedDone'
    )
    .with({ kind: 'entity' }, (): RowState => 'markedDone')
    .exhaustive();
}

/** The routine a turned-on routine suggestion saved; undefined until the feed says. */
export function savedRoutineId(suggestion: Suggestion): string | undefined {
  return suggestion.result?.entityType === 'scheduled_action'
    ? suggestion.result.entityId
    : undefined;
}
