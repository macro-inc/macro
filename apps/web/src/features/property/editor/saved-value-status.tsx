import { t } from '@app/lib/i18n';
import { CommandMenuEmptyState } from '@ui';
import { type Accessor, createEffect, on, type Setter } from 'solid-js';

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
 * Rows that arrive after a wait start with none highlighted: their first row
 * is "Clear all", and the Enter pressed while they loaded, or again as they
 * appear, would clear values the user has not seen.
 */
export function createUnhighlightedArrival(
  waits: Accessor<boolean>,
  searchValue: Accessor<string>,
  setSelectedIndex: Setter<number>
) {
  createEffect(
    on(waits, (waiting, wasWaiting) => {
      if (wasWaiting && !waiting && !searchValue().trim()) setSelectedIndex(-1);
    })
  );
}
