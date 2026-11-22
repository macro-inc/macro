import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { useCalendarNavigation } from '@app/features/calendar/context/calendar-navigation-context';
import {
  agendaWindow,
  clipAgendaWindow,
} from '@app/features/calendar/primitives/agenda-window';
import { createAgendaPaging } from '@app/features/calendar/primitives/create-agenda-paging';
import { getCalendarSupportedRange } from '@app/features/calendar/utils/calendar-supported-range';
import { t } from '@app/lib/i18n';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { AgendaGroupingContext } from '../../context/agenda-grouping-context';
import { useCalendarViewport } from '../../context/calendar-viewport-context';
import { createAgendaGrouping } from '../../primitives/create-agenda-grouping';
import { SelectedCalendarEvent } from '../selection/SelectedCalendarEvent';
import { AgendaWindow } from './AgendaWindow';

export function AgendaWindowList(props: { date: Date }) {
  const view = useCalendarView();
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const supportedRange = getCalendarSupportedRange();
  const viewportState = useCalendarViewport();
  const navigation = useCalendarNavigation();
  const paging = createAgendaPaging(viewport, props.date, {
    initialPosition: viewportState?.initial?.agenda,
    canLoadWindow: (index) =>
      clipAgendaWindow(agendaWindow(props.date, index), supportedRange) !==
      undefined,
  });
  if (viewportState) {
    onCleanup(
      viewportState.register(() => ({
        date: (navigation.navigationDate() ?? props.date).getTime(),
        agenda: paging.capturePosition(),
      }))
    );
  }
  const grouping = createAgendaGrouping();
  onMount(paging.positionInitial);

  return (
    <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={setViewport}
        role="region"
        aria-label={t('calendar.agendaEvents')}
        class="min-h-0 flex-1 overflow-y-auto touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+var(--calendar-grid-bottom-gap,12px))] [overflow-anchor:none]"
        onScroll={paging.onScroll}
      >
        <AgendaGroupingContext.Provider value={grouping}>
          <For each={paging.indices()}>
            {(index) => (
              <AgendaWindow
                anchor={props.date}
                index={index}
                active={paging.activeWindow() === index}
              />
            )}
          </For>
        </AgendaGroupingContext.Provider>
      </div>
      <Show when={viewport()}>
        {(boundary) => (
          <SelectedCalendarEvent
            boundary={boundary()}
            anchor={view.selectedEventAnchor}
            event={view.selectedEvent}
            timeFormat={() => view.displaySettings.timeFormat}
            onClose={view.closeEventDetails}
          />
        )}
      </Show>
    </div>
  );
}
