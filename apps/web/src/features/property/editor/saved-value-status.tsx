import { CommandMenuEmptyState } from '@ui';

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
        ? `Couldn't load this item's ${props.valuesLabel}`
        : `Loading ${props.valuesLabel}…`}
    </CommandMenuEmptyState>
  );
}
