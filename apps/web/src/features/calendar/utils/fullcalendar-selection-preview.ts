import { createPlugin, type EventApi } from '@fullcalendar/core';
import type {
  CalendarContentProps,
  DateRange,
  EventDef,
  EventInstance,
  EventStore,
  EventUi,
  ViewProps,
  ViewPropsTransformer,
} from '@fullcalendar/core/internal';
import { multiDayTimedDisplayRange } from './calendar-date';

const PREVIEW_DEF_ID = '__calendar-selection-preview-def__';
const PREVIEW_INSTANCE_ID = '__calendar-selection-preview-instance__';
const PREVIEW_EXTENDED_PROP = 'calendarSelectionPreview';

const previewUiBase: Omit<EventUi, 'display' | 'classNames'> = {
  startEditable: false,
  durationEditable: false,
  constraints: [],
  overlap: null,
  allows: [],
  backgroundColor: '',
  borderColor: '',
  textColor: '',
};

const allDayPreviewUi: EventUi = {
  ...previewUiBase,
  // Block + all-day only. Background all-day events are also painted through
  // the timed columns, which stretches the preview down the hour grid.
  display: 'block',
  classNames: ['calendar-multi-day-selection-preview-event'],
};

const timedPreviewUi: EventUi = {
  ...previewUiBase,
  display: 'auto',
  classNames: ['calendar-timed-selection-preview-event'],
};

/** Whether a rendered FullCalendar event is the date-selection preview. */
export function isSelectionPreview(event: Pick<EventApi, 'extendedProps'>) {
  return event.extendedProps[PREVIEW_EXTENDED_PROP] === true;
}

/**
 * Whether a date selection should render as an all-day preview chip
 * rather than FullCalendar's cell highlight overlay.
 */
export function shouldRenderSelectionAsAllDayPreview(selection: {
  allDay: boolean;
  start: Date;
  end: Date;
}) {
  return (
    selection.allDay ||
    multiDayTimedDisplayRange(selection.start, selection.end) !== undefined
  );
}

function createPreviewStore(range: DateRange, allDay: boolean): EventStore {
  const definition: EventDef = {
    defId: PREVIEW_DEF_ID,
    sourceId: '',
    publicId: PREVIEW_INSTANCE_ID,
    groupId: '',
    allDay,
    hasEnd: true,
    recurringDef: null,
    title: 'New event',
    url: '',
    ui: allDay ? allDayPreviewUi : timedPreviewUi,
    interactive: false,
    extendedProps: {
      [PREVIEW_EXTENDED_PROP]: true,
    },
  };
  const instance: EventInstance = {
    instanceId: PREVIEW_INSTANCE_ID,
    defId: PREVIEW_DEF_ID,
    range,
    forcedStartTzo: null,
    forcedEndTzo: null,
  };

  return {
    defs: { [PREVIEW_DEF_ID]: definition },
    instances: { [PREVIEW_INSTANCE_ID]: instance },
  };
}

class SelectionPreviewViewPropsTransformer implements ViewPropsTransformer {
  transform(viewProps: ViewProps, calendarProps: CalendarContentProps) {
    const selection = viewProps.dateSelection;
    if (!selection) return {};

    const multiDayRange = selection.allDay
      ? selection.range
      : timedSelectionPreviewRange(selection.range, calendarProps);
    // A timed selection within one day renders as an event rather than
    // FullCalendar's mirror, which draws over the events it overlaps. As an
    // event it takes part in overlap layout and shares the slot with them.
    const previewStore = multiDayRange
      ? createPreviewStore(multiDayRange, true)
      : createPreviewStore(selection.range, false);

    // Replace only the view projection. FullCalendar's canonical selection and
    // select callback retain the exact range used by the event composer.
    return {
      dateSelection: null,
      eventStore: {
        defs: {
          ...viewProps.eventStore.defs,
          ...previewStore.defs,
        },
        instances: {
          ...viewProps.eventStore.instances,
          ...previewStore.instances,
        },
      },
    };
  }
}

function timedSelectionPreviewRange(
  range: EventInstance['range'],
  calendarProps: CalendarContentProps
) {
  const displayRange = multiDayTimedDisplayRange(
    calendarProps.dateEnv.toDate(range.start),
    calendarProps.dateEnv.toDate(range.end)
  );
  if (!displayRange) return undefined;

  return {
    start: calendarProps.dateEnv.createMarker(displayRange.start),
    end: calendarProps.dateEnv.createMarker(displayRange.end),
  };
}

/**
 * Renders date selections as a preview event: all-day and multi-day ones as a
 * chip above existing all-day events, timed ones in the time grid alongside
 * the events they overlap.
 */
export const selectionPreviewRenderingPlugin = createPlugin({
  name: 'calendar-selection-preview-rendering',
  viewPropsTransformers: [SelectionPreviewViewPropsTransformer],
});
