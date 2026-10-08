import { For, Show } from 'solid-js';
import { BookingPicker } from '../components/booking-picker';
import type { BookingReceipt, PublicEvent, PublicProfile } from '../core/types';
import type { BookingSource } from '../primitives/booking-flow';

export function PublicBookingView(props: {
  profile: PublicProfile;
  event?: PublicEvent;
  source: BookingSource;
  onEvent: (slug: string) => void;
  onReceipt: (r: BookingReceipt) => void;
}) {
  return (
    <main class="min-h-screen overflow-y-auto bg-panel px-4 py-12 text-ink sm:py-20">
      <div class="mx-auto max-w-4xl">
        <a
          href="https://macro.com"
          class="mb-8 inline-block text-lg font-semibold tracking-tight"
        >
          Macro
          <span class="ml-2 text-sm font-normal text-ink-muted">
            Scheduling
          </span>
        </a>
        <Show
          when={props.event}
          fallback={
            <section class="mx-auto max-w-xl">
              <h1 class="text-3xl font-semibold">{props.profile.name}</h1>
              <p class="mt-3 whitespace-pre-wrap text-ink-muted">
                {props.profile.description}
              </p>
              <div class="mt-8 flex flex-col gap-3">
                <For
                  each={props.profile.eventTypes}
                  fallback={
                    <p class="rounded-xl border border-edge-muted p-8 text-sm text-ink-muted">
                      There are no bookable events right now.
                    </p>
                  }
                >
                  {(event) => (
                    <button
                      type="button"
                      class="rounded-xl border border-edge-muted bg-surface-1 p-6 text-left hover:bg-hover"
                      onClick={() => props.onEvent(event.slug)}
                    >
                      <h2 class="font-semibold">
                        {event.title} <span class="float-right">→</span>
                      </h2>
                      <p class="mt-2 text-sm text-ink-muted">
                        {event.durationMinutes} minutes ·{' '}
                        {event.googleMeet
                          ? 'Google Meet'
                          : event.location || 'Meeting'}
                      </p>
                      <p class="mt-3 text-sm text-ink-muted">
                        {event.description}
                      </p>
                    </button>
                  )}
                </For>
              </div>
            </section>
          }
        >
          {(event) => (
            <BookingPicker
              profile={props.profile}
              event={event()}
              source={props.source}
              onReceipt={props.onReceipt}
            />
          )}
        </Show>
        <p class="mt-8 text-center text-xs text-ink-muted">
          Scheduling by Macro
        </p>
      </div>
    </main>
  );
}
