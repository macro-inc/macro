import { createResizeObserver } from '@solid-primitives/resize-observer';
import { createSignal, type JSX, onCleanup } from 'solid-js';
import type { CalendarEvent } from '../types';
import { multiDayTimedDisplayRange } from '../utils/calendar-date';
import {
  CalendarGrid,
  type CalendarGridHandle,
  type CalendarGridProps,
  type CalendarGridSettings,
} from './CalendarGrid';

const NARROW_CALENDAR_WIDTH = 520;

/** Display settings owned by an embedded calendar's consumer. */
export type CalendarEmbedSettings = Omit<
  CalendarGridSettings,
  'showAllDaySlot' | 'useNarrowDayHeaders' | 'useNarrowEventContent'
> & {
  collapseEmptyAllDaySlot?: boolean;
};

export type CalendarEmbedProps = Omit<CalendarGridProps, 'settings'> & {
  settings: CalendarEmbedSettings;
};

function rendersInAllDaySlot(event: CalendarEvent) {
  return (
    event.allDay ||
    multiDayTimedDisplayRange(new Date(event.start), new Date(event.end)) !==
      undefined
  );
}

function CalendarEmbedHost(props: {
  handle: CalendarGridHandle;
  onWidthChange: (width: number) => void;
  children?: (handle: CalendarGridHandle) => JSX.Element;
}) {
  let resizeFrame: number | undefined;

  createResizeObserver(props.handle.element, ({ width }) => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);

    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined;
      props.onWidthChange(width);
      props.handle.api()?.updateSize();
    });
  });

  onCleanup(() => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
  });

  return <>{props.children?.(props.handle)}</>;
}

/**
 * Query-free calendar renderer for bounded containers. Its consumer owns data,
 * controls, selection behavior, and loading or error presentation.
 */
export function CalendarEmbed(props: CalendarEmbedProps) {
  const [isNarrow, setIsNarrow] = createSignal(false);

  return (
    <div class="calendar-embed size-full min-h-0 min-w-0 overflow-hidden">
      <CalendarGrid
        initialDate={props.initialDate}
        events={props.events}
        eventsById={props.eventsById}
        settings={{
          initialView: props.settings.initialView,
          dayCount: props.settings.dayCount,
          showDayHeaders: props.settings.showDayHeaders,
          showAllDaySlot:
            !props.settings.collapseEmptyAllDaySlot ||
            props.events.some(rendersInAllDaySlot),
          showWeekends: props.settings.showWeekends,
          weekStartsOn: props.settings.weekStartsOn,
          timeFormat: props.settings.timeFormat,
          useNarrowDayHeaders: isNarrow(),
          useNarrowEventContent: isNarrow(),
        }}
        selection={props.selection}
        eventTimeChangePending={props.eventTimeChangePending}
        onDatesSet={props.onDatesSet}
        onEventTimeChange={props.onEventTimeChange}
      >
        {(handle) => (
          <CalendarEmbedHost
            handle={handle}
            onWidthChange={(width) =>
              setIsNarrow(width < NARROW_CALENDAR_WIDTH)
            }
            children={props.children}
          />
        )}
      </CalendarGrid>
    </div>
  );
}
