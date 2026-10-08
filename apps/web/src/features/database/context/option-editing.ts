import type { ResultAsync } from 'neverthrow';
import { createContext, useContext } from 'solid-js';
import type { DatabaseOpFailure } from '../core/write-failure';

/** A new label, hex colour from the tag palette, or both, for one option. */
export type OptionChange = { label?: string; color?: string };

/** Changes to a column's options, for the table the grid shows. */
export type OptionEditing = {
  update: (
    columnId: string,
    optionId: string,
    change: OptionChange
  ) => ResultAsync<void, DatabaseOpFailure>;
  remove: (
    columnId: string,
    optionId: string
  ) => ResultAsync<void, DatabaseOpFailure>;
};

export const OptionEditingContext = createContext<OptionEditing>();

/** Option editing where the grid offers it; viewers and tests have none. */
export function useOptionEditing(): OptionEditing | undefined {
  return useContext(OptionEditingContext);
}
