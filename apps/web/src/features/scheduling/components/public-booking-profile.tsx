import { For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { meetingPlaceLabel, type PublicProfile } from '../core/types';

export function PublicBookingProfile(props: {
  profile: PublicProfile;
  onEvent?: (slug: string) => void;
  heading?: JSX.Element;
  introduction?: JSX.Element;
}) {
  return (
    <section class="mx-auto max-w-2xl">
      <p class="text-xs font-medium uppercase tracking-wider text-ink-muted">
        Find a time to connect
      </p>
      <Show
        when={props.heading}
        fallback={
          <h1 class="mt-3 break-words text-3xl font-semibold tracking-tight @min-[640px]/public-booking:text-4xl">
            {props.profile.name}
          </h1>
        }
      >
        {props.heading}
      </Show>
      <Show
        when={props.introduction}
        fallback={
          <Show when={props.profile.description}>
            <p class="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-muted">
              {props.profile.description}
            </p>
          </Show>
        }
      >
        {props.introduction}
      </Show>
      <h2 class="mt-10 mb-3 text-sm font-medium">Choose a meeting</h2>
      <div class="flex flex-col gap-3">
        <For
          each={props.profile.eventTypes}
          fallback={
            <p class="rounded-xl border border-edge-muted bg-surface-1 p-6 text-sm text-ink-muted">
              There are no bookable events right now.
            </p>
          }
        >
          {(event) => (
            <Dynamic
              component={props.onEvent ? 'button' : 'div'}
              type={props.onEvent ? 'button' : undefined}
              class="group flex items-start justify-between gap-5 rounded-xl border border-edge-muted bg-surface-1 p-5 text-left transition-colors enabled:hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent @min-[640px]/public-booking:p-6"
              onClick={
                props.onEvent ? () => props.onEvent?.(event.slug) : undefined
              }
            >
              <div class="min-w-0">
                <h3 class="break-words font-semibold">{event.title}</h3>
                <p class="mt-2 break-words text-xs text-ink-muted">
                  {event.durationMinutes} minutes · {meetingPlaceLabel(event)}
                </p>
                <Show when={event.description}>
                  <p class="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-muted">
                    {event.description}
                  </p>
                </Show>
              </div>
              <span
                aria-hidden="true"
                class="shrink-0 text-ink-muted transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
              >
                →
              </span>
            </Dynamic>
          )}
        </For>
      </div>
    </section>
  );
}
