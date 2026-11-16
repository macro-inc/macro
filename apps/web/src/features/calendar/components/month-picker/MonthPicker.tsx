import type { ParentProps } from 'solid-js';
import { createMonthPicker } from '../../primitives/create-month-picker';
import { MonthPickerContext } from './month-picker-context';

export type MonthPickerProps = ParentProps<{
  /** Initial selected date for one open picker session. */
  date: Date;
  onSelect: (date: Date) => void;
}>;

/**
 * One month/year selection session, composed from Header, Grid, and DateEntry.
 * @do Mount a fresh session when its containing popover opens.
 * @dont Navigate the calendar just because the browsed year changes.
 */
export function MonthPicker(props: MonthPickerProps) {
  const picker = createMonthPicker(props.date, (date) => props.onSelect(date));
  return (
    <MonthPickerContext.Provider value={picker}>
      <div class="flex flex-col gap-3">{props.children}</div>
    </MonthPickerContext.Provider>
  );
}
