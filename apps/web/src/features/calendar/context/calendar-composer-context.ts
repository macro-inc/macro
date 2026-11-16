import { createContext, useContext } from 'solid-js';
import type { CalendarComposerModel } from '../primitives/create-calendar-composer';

export const CalendarComposerContext = createContext<CalendarComposerModel>();

export function useCalendarComposer() {
  const model = useContext(CalendarComposerContext);
  if (!model) throw new Error('Calendar composer parts require ComposerRoot');
  return model;
}
