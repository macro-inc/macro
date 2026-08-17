import { CalendarPagerContextProvider } from '@app/features/calendar/CalendarPagerContext';
import { CalendarViewContextProvider } from '@app/features/calendar/CalendarViewContext';
import {
  CalendarFocusContextProvider,
  type CalendarFocusTarget,
} from '@app/features/calendar/calendar-focus-target';
import { Workspace } from './Workspace';

/** Full calendar block composition backed by reusable calendar capabilities. */
export function View(props: { focusTarget?: CalendarFocusTarget }) {
  return (
    <CalendarFocusContextProvider target={() => props.focusTarget}>
      <CalendarViewContextProvider>
        <CalendarPagerContextProvider>
          <Workspace />
        </CalendarPagerContextProvider>
      </CalendarViewContextProvider>
    </CalendarFocusContextProvider>
  );
}
