import { cn } from '@ui';
import { For, Show } from 'solid-js';
import { BookingPicker } from '../components/booking-picker';
import {
  type BookingReceipt,
  meetingPlaceLabel,
  type PublicEvent,
  type PublicProfile,
} from '../core/types';
import type { BookingSource } from '../primitives/booking-flow';

export function PublicBookingView(props: {
  profile: PublicProfile;
  event?: PublicEvent;
  source: BookingSource;
  onEvent: (slug: string) => void;
  onReceipt: (r: BookingReceipt) => void;
  /** Shown inside another Macro page, which already carries the Macro name. */
  embedded?: boolean;
}) {
  return (
    <main
      class={cn(
        'min-h-screen overflow-y-auto bg-panel px-4 text-ink',
        props.embedded ? 'py-4' : 'py-12 sm:py-20'
      )}
    >
      <div class="mx-auto max-w-4xl">
        <Show when={!props.embedded}>
          <a
            href="https://macro.com"
            class="mb-8 inline-block text-lg font-semibold tracking-tight"
          >
            Macro
            <span class="ml-2 text-sm font-normal text-ink-muted">
              Scheduling
            </span>
          </a>
        </Show>
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
                        {meetingPlaceLabel(event)}
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
        <Show when={!props.embedded}>
          <p class="mt-8 text-center text-xs text-ink-muted">
            Scheduling by Macro
          </p>
        </Show>
      </div>
    </main>
  );
}
