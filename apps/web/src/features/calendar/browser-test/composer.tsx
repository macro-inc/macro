import '@fontsource-variable/inter';
import '../../../index.css';
import { EventComposerSplit } from '@app/features/block-calendar/components/EventComposerSplit';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  createCalendarOccurrenceQueryRange,
  useCalendarOccurrencesQuery,
} from '@queries/calendar/occurrences';
import { handleRefreshCalendar } from '@queries/calendar/sync';
import { queryClient } from '@queries/client';
import { queryReadyGate } from '@queries/gate';
import { QueryClientProvider } from '@tanstack/solid-query';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { type CalendarEvent, mapCalendarOccurrence } from '../types';

declare global {
  interface Window {
    calendarFixture: {
      /** Hands the app a `refresh_calendar` frame, as its socket does. */
      refreshCalendar: (payload: unknown) => void;
    };
  }
}
window.calendarFixture = { refreshCalendar: handleRefreshCalendar };
document.documentElement.dataset.touchDevice = String(isTouchDevice());

// The week the tests' events are in, read as the calendar reads a viewport.
const WEEK = createCalendarOccurrenceQueryRange(
  new Date(2030, 0, 1),
  new Date(2030, 0, 8)
);

/**
 * One week's events as a list; an event opens in the real composer split,
 * which saves through the real editor and mutations.
 */
function Fixture() {
  const userId = useUserId();
  const occurrences = useCalendarOccurrencesQuery(() => ({
    userId: userId(),
    range: WEEK,
  }));
  const events = () =>
    queryReadyGate(occurrences)
      ? occurrences.data.items.map((item) => mapCalendarOccurrence(item))
      : [];
  const [editing, setEditing] = createSignal<CalendarEvent>();
  const [saved, setSaved] = createSignal(0);
  // The split's panel, reduced to what a composer asks of it: closing.
  const panel = {
    handle: { close: () => setEditing(undefined), setDisplayName: () => {} },
  } as unknown as SplitPanelContextType;

  return (
    <main class="flex h-dvh gap-4 bg-page p-4 text-ink">
      <section aria-label="Events" class="flex w-56 flex-col gap-2">
        <For each={events()}>
          {(event) => (
            <Button
              variant="secondary"
              size="md"
              fullWidth
              onClick={() => setEditing(event)}
            >
              {event.title}
            </Button>
          )}
        </For>
        <Show when={saved() > 0}>
          <p role="status" aria-label="Saves" class="text-sm text-ink-muted">
            Saved {saved()}
          </p>
        </Show>
      </section>
      <Show when={editing()} keyed>
        {(event) => (
          <section
            aria-label="Event composer"
            class="portal-scope relative w-120 rounded-xl bg-surface"
          >
            <SplitPanelContext.Provider value={panel}>
              <EventComposerSplit
                event={event}
                onSaveSuccess={() => setSaved((count) => count + 1)}
              />
            </SplitPanelContext.Provider>
          </section>
        )}
      </Show>
    </main>
  );
}

const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Fixture />
      </QueryClientProvider>
    ),
    root
  );
