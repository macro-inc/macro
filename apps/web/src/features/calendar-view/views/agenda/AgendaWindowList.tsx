import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { createAgendaPaging } from '@app/features/calendar/primitives/create-agenda-paging';
import { t } from '@app/lib/i18n';
import { createSignal, For, onMount, Show } from 'solid-js';
import { AgendaGroupingContext } from '../../context/agenda-grouping-context';
import { createAgendaGrouping } from '../../primitives/create-agenda-grouping';
import { SelectedCalendarEvent } from '../selection/SelectedCalendarEvent';
import { AgendaWindow } from './AgendaWindow';

export function AgendaWindowList(props: { date: Date }) {
  const view = useCalendarView();
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const paging = createAgendaPaging(viewport, props.date);
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
