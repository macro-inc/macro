import '../../../index.css';
import '@fontsource-variable/inter';
import { createSignal, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { createElicitationReviewSink } from '../../block-agent/state/elicitation-review-sink';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { themeCssVars } from '../../theme/utils/themeColorTokens';
import { BookingLinkDraftComposer } from '../components/booking-link-draft-composer';
import type { BookingLinkArgs } from '../core/booking-link';
import { newEventType, newSchedule } from '../core/types';

function Fixture() {
  onMount(() => {
    for (const [key, value] of Object.entries(themeCssVars(macroLightTheme)))
      document.documentElement.style.setProperty(key, value);
    document.documentElement.style.colorScheme = 'light';
  });
  const schedule = newSchedule('America/New_York');
  const { id: _scheduleId, ...hours } = schedule;
  const {
    id: _eventId,
    scheduleId: _sid,
    ...details
  } = newEventType(schedule.id, ['macro|qa@example.test'], false);
  const initial: BookingLinkArgs = {
    teamId: null,
    draft: {
      event: { ...details, title: 'Intro call', slug: 'intro', enabled: true },
      schedule: hours,
    },
  };
  const [draft, setDraft] = createSignal<BookingLinkArgs>();
  const [result, setResult] = createSignal('');
  const [fail, setFail] = createSignal(false);
  const [reviewCount, setReviewCount] = createSignal(0);
  const sink = createElicitationReviewSink<BookingLinkArgs>({
    canAnswer: () => true,
    respond: async (answer) => {
      if (fail())
        throw new Error(
          'Configuration changed. Refresh and review the latest booking link.'
        );
      setReviewCount((count) => count + 1);
      setResult(JSON.stringify(answer, null, 2));
      setDraft(undefined);
      return true;
    },
  });
  return (
    <main class="h-screen overflow-auto bg-panel p-2 text-ink sm:p-6">
      <div class="mx-auto flex max-w-3xl flex-col gap-3">
        <h1 class="text-xl font-semibold">Booking link review</h1>
        <p>
          Isolated QA fixture. Decisions use the agent elicitation sink; no
          hosted data or invitations.
        </p>
        <div class="flex flex-wrap gap-4">
          <button
            onClick={() => {
              setDraft(undefined);
              queueMicrotask(() => setDraft(structuredClone(initial)));
            }}
          >
            New booking link
          </button>
          <button
            onClick={() => {
              setDraft(undefined);
              queueMicrotask(() =>
                setDraft({
                  ...structuredClone(initial),
                  eventTypeId: crypto.randomUUID(),
                  expectedRevision: 7,
                })
              );
            }}
          >
            Edit booking link
          </button>
          <label>
            <input
              type="checkbox"
              checked={fail()}
              onChange={(event) => setFail(event.currentTarget.checked)}
            />
            Simulate save error
          </label>
        </div>
        <Show when={draft()} keyed>
          {(value) => (
            <BookingLinkDraftComposer
              initialData={value}
              sink={sink}
              members={[]}
            />
          )}
        </Show>
        <output aria-label="Review count">{reviewCount()}</output>
        <pre
          class="overflow-auto whitespace-pre-wrap break-all"
          aria-label="Review result"
        >
          {result()}
        </pre>
      </div>
    </main>
  );
}
render(() => <Fixture />, document.getElementById('root')!);
