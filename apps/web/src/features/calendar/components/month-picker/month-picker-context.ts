import { createContext, useContext } from 'solid-js';
import type { createMonthPicker } from '../../primitives/create-month-picker';
import type { MonthYearPickerProps } from './MonthPicker';

export const MonthPickerContext = createContext<
  ReturnType<typeof createMonthPicker> & {
    props: MonthYearPickerProps;
    gridId: string;
    focusGrid: () => void;
  }
>();

export function useMonthPicker() {
  const context = useContext(MonthPickerContext);
  if (!context) throw new Error('Month picker parts require MonthYearPicker');
  return context;
}
