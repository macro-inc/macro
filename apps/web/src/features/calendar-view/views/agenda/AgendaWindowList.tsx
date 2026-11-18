import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import {
  createAgendaPaging,
  findAgendaDayAnchor,
} from '@app/features/calendar/primitives/create-agenda-paging';
import { t } from '@app/lib/i18n';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { AgendaGroupingContext } from '../../context/agenda-grouping-context';
import { createAgendaGrouping } from '../../primitives/create-agenda-grouping';
import { SelectedCalendarEvent } from '../selection/SelectedCalendarEvent';
import { AgendaWindow } from './AgendaWindow';

export function AgendaWindowList(props: { date: Date }) {
  const view = useCalendarView();
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const paging = createAgendaPaging(viewport, props.date);
  const grouping = createAgendaGrouping();
  onMount(() => {
    paging.positionInitial();
    const element = viewport();
    if (!element) return;
    // Empty windows can be shorter than the phone viewport before data arrives.
    // Keep the requested day in place while their heights grow.
    const observer = new ResizeObserver(() => {
      const day = findAgendaDayAnchor(element, props.date);
      if (!day) return;
      if (
        Math.abs(
          day.getBoundingClientRect().top - element.getBoundingClientRect().top
        ) < 2
      ) {
        observer.disconnect();
      } else {
        paging.positionInitial();
      }
    });
    for (const window of element.querySelectorAll('[data-agenda-window]'))
      observer.observe(window);
    const stop = () => observer.disconnect();
    element.addEventListener('pointerdown', stop);
    element.addEventListener('wheel', stop);
    onCleanup(() => {
      stop();
      element.removeEventListener('pointerdown', stop);
      element.removeEventListener('wheel', stop);
    });
  });

  return (
    <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={setViewport}
        role="region"
        aria-label={t('calendar.agendaEvents')}
        class="min-h-0 flex-1 overflow-y-auto touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+6rem)] [overflow-anchor:none]"
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
