import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { createAgendaPaging } from '@app/features/calendar/primitives/create-agenda-paging';
import { t } from '@app/lib/i18n';
import { createSignal, For, onMount, Show } from 'solid-js';
import { SelectedEventDetails } from '../../components/SelectedEventDetails';
import { AgendaWindow } from './AgendaWindow';

export function AgendaWindowList(props: { date: Date }) {
  const view = useCalendarView();
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const paging = createAgendaPaging(viewport, props.date);
  onMount(paging.positionInitial);

  return (
    <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={setViewport}
        role="region"
        aria-label={t('calendar.agendaEvents')}
        class="min-h-0 flex-1 overflow-y-auto"
        onScroll={paging.onScroll}
      >
        <For each={paging.indices()}>
          {(index) => (
            <AgendaWindow
              anchor={props.date}
              index={index}
              active={paging.activeWindow() === index}
            />
          )}
        </For>
      </div>
      <Show when={viewport()}>
        {(boundary) => (
          <SelectedEventDetails
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
