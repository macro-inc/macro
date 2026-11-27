import { type Accessor, createContext, useContext } from 'solid-js';
import type { CalendarPeriodView } from '../types';

export interface CalendarDateRange {
  start: Date;
  end: Date;
}

/** Navigation capabilities supplied by the calendar workspace, independent of its grid. */
export interface CalendarNavigationContext {
  periodView: Accessor<CalendarPeriodView>;
  /** Date displayed at the viewport centre, including native scrolling. */
  activeDate: Accessor<Date | undefined>;
  /** Current displayed or explicitly requested navigation date. */
  navigationDate: Accessor<Date | undefined>;
  /** All displayed days, including adjacent-month cells. */
  displayRange: Accessor<CalendarDateRange | undefined>;
  /** Week highlighted in the mini-month; absent outside week views. */
  weekRange: Accessor<CalendarDateRange | undefined>;
  /** Queried range associated with the visible view's data. */
  visibleRange: Accessor<CalendarDateRange | undefined>;
  /** Jump directly, without a page transition. */
  gotoDate: (date: Date) => void;
  /** Navigate through the host's normal page transition. */
  navigateToDate: (date: Date) => void;
  navigateToToday: () => void;
  previousPeriod: () => void;
  nextPeriod: () => void;
  changeView: (view: CalendarPeriodView) => void;
}

const Context = createContext<CalendarNavigationContext>();
export const CalendarNavigationProvider = Context.Provider;

export function useCalendarNavigation(): CalendarNavigationContext {
  const context = useContext(Context);
  if (!context) throw new Error('CalendarNavigationProvider is required');
  return context;
}
