import { createPlugin, type EventApi } from '@fullcalendar/core';
import type {
  CalendarContentProps,
  EventDef,
  EventInstance,
  EventStore,
  EventUi,
  ViewProps,
  ViewPropsTransformer,
} from '@fullcalendar/core/internal';
import { multiDayTimedDisplayRange } from './calendar-date';

const PREVIEW_DEF_ID = '__calendar-multi-day-selection-preview-def__';
const PREVIEW_INSTANCE_ID = '__calendar-multi-day-selection-preview-instance__';
const PREVIEW_EXTENDED_PROP = 'calendarMultiDaySelectionPreview';

const previewUi: EventUi = {
  // Block + all-day only. Background all-day events are also painted through
  // the timed columns, which stretches the preview down the hour grid.
  display: 'block',
  startEditable: false,
  durationEditable: false,
  constraints: [],
  overlap: null,
  allows: [],
  backgroundColor: '',
  borderColor: '',
  textColor: '',
  classNames: ['calendar-multi-day-selection-preview-event'],
};

/** Whether a rendered FullCalendar event is the date-selection preview. */
export function isMultiDaySelectionPreview(
  event: Pick<EventApi, 'extendedProps'>
) {
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

function createPreviewStore(range: EventInstance['range']): EventStore {
  const definition: EventDef = {
    defId: PREVIEW_DEF_ID,
    sourceId: '',
    publicId: PREVIEW_INSTANCE_ID,
    groupId: '',
    allDay: true,
    hasEnd: true,
    recurringDef: null,
    title: 'New event',
    url: '',
    ui: previewUi,
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

class MultiDaySelectionViewPropsTransformer implements ViewPropsTransformer {
  transform(viewProps: ViewProps, calendarProps: CalendarContentProps) {
    const selection = viewProps.dateSelection;
    if (!selection) return {};

    const previewRange = selection.allDay
      ? selection.range
      : timedSelectionPreviewRange(selection.range, calendarProps);
    if (!previewRange) return {};

    const previewStore = createPreviewStore(previewRange);

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

/** Renders all-day and multi-day selections as a chip above existing all-day events. */
export const multiDaySelectionRenderingPlugin = createPlugin({
  name: 'calendar-multi-day-selection-rendering',
  viewPropsTransformers: [MultiDaySelectionViewPropsTransformer],
});
