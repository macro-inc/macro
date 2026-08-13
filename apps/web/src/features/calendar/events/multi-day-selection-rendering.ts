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
import { multiDayTimedDisplayRange } from './multi-day-rendering';

const PREVIEW_DEF_ID = '__calendar-multi-day-selection-preview-def__';
const PREVIEW_INSTANCE_ID = '__calendar-multi-day-selection-preview-instance__';
const PREVIEW_EXTENDED_PROP = 'calendarMultiDaySelectionPreview';

const previewUi: EventUi = {
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

/** Whether a rendered FullCalendar event is the multi-day selection preview. */
export function isMultiDaySelectionPreview(
  event: Pick<EventApi, 'extendedProps'>
) {
  return event.extendedProps[PREVIEW_EXTENDED_PROP] === true;
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
    if (!selection || selection.allDay) return {};

    const displayRange = multiDayTimedDisplayRange(
      calendarProps.dateEnv.toDate(selection.range.start),
      calendarProps.dateEnv.toDate(selection.range.end)
    );
    if (!displayRange) return {};

    const previewStore = createPreviewStore({
      start: calendarProps.dateEnv.createMarker(displayRange.start),
      end: calendarProps.dateEnv.createMarker(displayRange.end),
    });

    // Replace only the view projection. FullCalendar's canonical selection and
    // select callback retain the exact timed range used by the event composer.
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

/** Renders multi-day timed selections as foreground all-day preview events. */
export const multiDaySelectionRenderingPlugin = createPlugin({
  name: 'calendar-multi-day-selection-rendering',
  viewPropsTransformers: [MultiDaySelectionViewPropsTransformer],
});
