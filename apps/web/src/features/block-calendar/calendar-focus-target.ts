import { createAssertedContextProvider } from '@core/context/createContext';
import { type Accessor, createSignal, type ParentProps } from 'solid-js';

const FOCUS_TARGET_TTL_MS = 15_000;

/** A request for one calendar view instance to focus a rendered occurrence. */
export interface CalendarFocusTarget {
  /** Canonical calendar event entity id. */
  eventId: string;
  /** Stable occurrence key within the event. */
  occurrenceKey: string;
  /** Occurrence start, used to page the calendar to the right date. */
  date: Date;
  /** Monotonic id that allows the same target to be requested repeatedly. */
  requestId: number;
  /** Time the navigation was requested, used to reject delayed focus. */
  requestedAt: number;
}

/** The grid's composite view-model id for a focus target. */
export function calendarFocusTargetId(target: CalendarFocusTarget): string {
  return JSON.stringify([target.eventId, target.occurrenceKey]);
}

interface CalendarFocusContextProps extends ParentProps {
  target?: Accessor<CalendarFocusTarget | undefined>;
}

/** Instance-scoped focus state for one mounted calendar workspace. */
export const [CalendarFocusContextProvider, useCalendarFocus] =
  createAssertedContextProvider(
    'CalendarFocusContext',
    (props: CalendarFocusContextProps) => {
      const [consumedRequestId, setConsumedRequestId] = createSignal<number>();
      return {
        pendingTarget: () => {
          const target = props.target?.();
          if (
            !target ||
            target.requestId === consumedRequestId() ||
            Date.now() - target.requestedAt > FOCUS_TARGET_TTL_MS
          ) {
            return undefined;
          }
          return target;
        },
        consume: (requestId: number) => setConsumedRequestId(requestId),
      };
    }
  );
