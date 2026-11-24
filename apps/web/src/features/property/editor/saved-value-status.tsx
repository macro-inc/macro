import { t } from '@app/lib/i18n';
import { CommandMenuEmptyState } from '@ui';
import { type Accessor, createEffect, type Setter, untrack } from 'solid-js';

/** Whether the values a saved item already holds have been read. */
export type SavedValueState = 'known' | 'loading' | 'failed';

/** Takes the place of an editor's rows until the item's values are read. */
export function SavedValueStatus(props: {
  state: SavedValueState;
  valuesLabel: string;
}) {
  return (
    <CommandMenuEmptyState>
      {props.state === 'failed'
        ? t('entityActions.propertyValuesUnavailable', {
            values: props.valuesLabel,
          })
        : t('entityActions.propertyValuesLoading', {
            values: props.valuesLabel,
          })}
    </CommandMenuEmptyState>
  );
}

/**
 * Rows that arrive after a wait start with none highlighted: the first may be
 * "Clear all", and the Enter pressed while they loaded, or again as they
 * appear, would clear values the user has not seen. A typed search that found
 * a match keeps it highlighted.
 */
export function createUnhighlightedArrival(
  waits: Accessor<boolean>,
  hasRows: Accessor<boolean>,
  searchFoundMatch: Accessor<boolean>,
  setSelectedIndex: Setter<number>
) {
  let waited = false;

  // The list resets its highlight while it is empty, so wait for its rows.
  createEffect(() => {
    if (waits()) {
      waited = true;
      return;
    }
    if (!waited || !hasRows()) return;

    waited = false;
    if (!untrack(searchFoundMatch)) setSelectedIndex(-1);
  });
}
