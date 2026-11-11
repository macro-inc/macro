import '@fontsource-variable/inter';
import '../../../index.css';
import { fireAndForget } from '@core/util/fireAndForget';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { CalendarGrid } from '../../calendar/components/CalendarGrid';
import { RecurringEventScopeDialog } from '../../calendar/components/RecurringEventScopeDialog';
import { createEventTimeChange } from '../../calendar/primitives/create-event-time-change';
import { RECURRING_EVENT } from '../../calendar/tests/fixtures';
import type { CalendarEvent, CalendarPeriodView } from '../../calendar/types';
import { macroLightTheme } from '../../theme/themes/macro-light';

for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.themeLight = 'true';

const PARAMS = new URLSearchParams(location.search);
const INITIAL_EVENT: CalendarEvent = {
  ...RECURRING_EVENT,
  recurrenceLines: ['RRULE:FREQ=WEEKLY;BYDAY=MO'],
  timeZone: 'UTC',
  start: '2026-11-09T10:00:00Z',
  end: PARAMS.has('projected')
    ? '2026-11-11T11:00:00Z'
    : '2026-11-09T11:00:00Z',
  occurrenceKey: '2026-11-09T10:00:00Z',
  seriesTime: {
    kind: 'timed',
    startsAt: '2026-10-26T10:00:00Z',
    endsAt: '2026-10-26T11:00:00Z',
    timeZone: 'UTC',
  },
};

function Fixture() {
  const [events, setEvents] = createSignal([INITIAL_EVENT]);
  const eventsById = createMemo(
    () => new Map(events().map((event) => [event.id, event]))
  );
  const [request, setRequest] = createSignal('');
  const [error, setError] = createSignal('');
  const controller = createEventTimeChange({
    active: () => true,
    save: async ({ parentSpan: _span, ...args }) => {
      setRequest(JSON.stringify(args));
      if (PARAMS.has('failure')) throw new Error('Fixture save failed');
      const time = args.patch.time;
      if (time?.kind !== 'timed')
        throw new Error('Expected timed fixture update');
      const master = INITIAL_EVENT.seriesTime;
      if (master?.kind !== 'timed') throw new Error('Expected timed series');
      const offset =
        args.scope === 'all'
          ? Date.parse(INITIAL_EVENT.start) - Date.parse(master.startsAt)
          : 0;
      setEvents([
        {
          ...INITIAL_EVENT,
          start: new Date(Date.parse(time.startsAt) + offset).toISOString(),
          end: new Date(Date.parse(time.endsAt) + offset).toISOString(),
        },
      ]);
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : 'Save failed'),
  });
  const refresh = () =>
    setEvents((current) => current.map((event) => ({ ...event })));
  window.addEventListener('calendar-fixture-refresh', refresh);
  onCleanup(() =>
    window.removeEventListener('calendar-fixture-refresh', refresh)
  );
  const view: CalendarPeriodView =
    PARAMS.get('view') === 'day' ? 'timeGridDay' : 'timeGridWeek';
  return (
    <main class="portal-scope h-screen bg-page text-ink p-4 flex flex-col gap-2">
      <h1>Calendar time-change fixture</h1>
      <div class="flex-1 min-h-0">
        <CalendarGrid
          initialDate={new Date('2026-11-09T00:00:00Z')}
          events={events()}
          eventsById={eventsById()}
          settings={{
            initialView: view,
            showWeekends: true,
            weekStartsOn: 1,
            timeFormat: '24-hour',
            useNarrowDayHeaders: false,
            useNarrowEventContent: false,
          }}
          selection={{ color: 'var(--color-accent)' }}
          eventTimeChangePending={controller.pending()}
          onEventTimeChange={(change, event) =>
            fireAndForget(controller.handle(change, event), 'calendar-fixture')
          }
        />
      </div>
      <RecurringEventScopeDialog
        open={controller.choosing()}
        title="Save repeating event"
        scope={controller.scope()}
        options={[
          { scope: 'this_event', label: 'This event' },
          { scope: 'all', label: 'All events' },
        ]}
        onScopeChange={controller.setScope}
        onClose={controller.cancel}
        onConfirm={() =>
          fireAndForget(controller.confirm(), 'calendar-fixture')
        }
        confirmLabel="Save"
      />
      <pre data-testid="request">{request()}</pre>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
    </main>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
