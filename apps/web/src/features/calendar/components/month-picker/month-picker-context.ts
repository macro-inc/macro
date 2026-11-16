import { createContext, useContext } from 'solid-js';
import type { createMonthPicker } from '../../primitives/create-month-picker';

export const MonthPickerContext =
  createContext<ReturnType<typeof createMonthPicker>>();

export function useMonthPicker() {
  const context = useContext(MonthPickerContext);
  if (!context) throw new Error('Month picker parts require MonthPicker');
  return context;
}
