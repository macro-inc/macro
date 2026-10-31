import { createAssertedContextProvider } from '@core/context/createContext';
import { debounce } from '@core/util/debounce';
import { type Accessor, createSignal, type ParentProps } from 'solid-js';

const FOCUS_TARGET_TTL_MS = 15_000;
/** How long an in-calendar request waits for its chip before falling back. */
export const OCCURRENCE_FOCUS_TIMEOUT_MS = 2_000;

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

/** An occurrence to focus from inside the calendar, such as a sidebar row. */
export type CalendarFocusOccurrence = Pick<
  CalendarFocusTarget,
  'eventId' | 'occurrenceKey' | 'date'
>;

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
      // In-calendar requests count down from -1, so their ids never meet the
      // navigation requests' ids.
      const [occurrenceTarget, setOccurrenceTarget] =
        createSignal<CalendarFocusTarget>();
      let nextOccurrenceRequestId = -1;
      let fallback: (() => void) | undefined;

      const navigationTarget = () => {
        const target = props.target?.();
        if (
          !target ||
          target.requestId === consumedRequestId() ||
          Date.now() - target.requestedAt > FOCUS_TARGET_TTL_MS
        ) {
          return undefined;
        }
        return target;
      };
      const supersededByNavigation = (occurrence: CalendarFocusTarget) => {
        const navigation = props.target?.();
        return (
          navigation !== undefined &&
          navigation.requestedAt > occurrence.requestedAt
        );
      };
      const expireOccurrence = debounce(() => {
        const occurrence = occurrenceTarget();
        const open = fallback;
        fallback = undefined;
        setOccurrenceTarget(undefined);
        if (occurrence && !supersededByNavigation(occurrence)) open?.();
      }, OCCURRENCE_FOCUS_TIMEOUT_MS);
      const dropOccurrence = () => {
        expireOccurrence.clear();
        fallback = undefined;
        setOccurrenceTarget(undefined);
      };

      return {
        pendingTarget: () => {
          const occurrence = occurrenceTarget();
          if (occurrence && !supersededByNavigation(occurrence)) {
            return occurrence;
          }
          return navigationTarget();
        },
        consume: (requestId: number) => {
          if (occurrenceTarget()?.requestId === requestId) dropOccurrence();
          else setConsumedRequestId(requestId);
        },
        /** Drops a pending in-calendar request without its fallback. */
        cancelOccurrence: dropOccurrence,
        /**
         * Pages to an occurrence and opens its details on its chip, as a
         * navigation request does. Calls `onTimeout` instead when no page
         * renders the chip in time, for example when it is filtered out.
         */
        focusOccurrence: (
          occurrence: CalendarFocusOccurrence,
          onTimeout: () => void
        ) => {
          // The newer request wins over a navigation that has not landed yet.
          const navigation = props.target?.();
          if (navigation) setConsumedRequestId(navigation.requestId);
          fallback = onTimeout;
          setOccurrenceTarget({
            ...occurrence,
            requestId: nextOccurrenceRequestId--,
            requestedAt: Date.now(),
          });
          expireOccurrence();
        },
      };
    }
  );
