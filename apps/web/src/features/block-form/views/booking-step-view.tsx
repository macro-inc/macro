import { BookingPicker } from '@app/features/scheduling/components/booking-picker';
import Check from '@phosphor/check-circle.svg';
import Eye from '@phosphor/eye.svg';
import { Match, Show, Switch } from 'solid-js';
import { SectionHeading } from '../components/respond/respond-screens';
import { useFormContext } from '../context/form-context';
import type { UnlockedBooking } from '../core/form-model';

/**
 * The booking step: the native booking picker for the event the server
 * unlocked, or in preview the editor's own event, which shows real times
 * but never books.
 */
export function BookingStepView(props: {
  booking: UnlockedBooking;
  preview: boolean;
}) {
  const context = useFormContext();
  const event = context.booking.createEvent(() => props.booking.target);
  const source = context.booking.createSource();
  return (
    <section
      class="flex flex-col gap-3"
      aria-label={props.booking.title || 'Book a time'}
    >
      <Show
        when={props.preview}
        fallback={
          <p
            role="status"
            class="flex items-center gap-2 rounded-lg border border-edge-muted bg-panel px-3 py-2 text-sm text-ink"
          >
            <Check class="size-4 shrink-0 text-success" aria-hidden="true" />
            Your response is saved. Choose a time to finish.
          </p>
        }
      >
        <p class="flex items-center gap-2 rounded-lg border border-edge-muted bg-panel px-3 py-2 text-sm text-ink-muted">
          <Eye class="size-4 shrink-0" aria-hidden="true" />
          Preview: browse the real availability. Nothing is booked.
        </p>
      </Show>
      <SectionHeading
        title={props.booking.title || 'Book a time'}
        description={props.booking.description}
      />
      <Switch
        fallback={
          <div
            class="h-80 animate-pulse rounded-2xl bg-hover"
            aria-busy="true"
            aria-label="Loading the calendar"
          />
        }
      >
        <Match when={event.failure()}>
          <p
            role="alert"
            class="rounded-xl border border-edge bg-surface px-4 py-3 text-sm text-ink"
          >
            The calendar couldn’t be loaded. Reload the page to try again.
          </p>
        </Match>
        <Match when={event.value() === null}>
          <p
            role="alert"
            class="rounded-xl border border-edge bg-surface px-4 py-3 text-sm text-ink"
          >
            This booking link is no longer available. The form’s owner can share
            another way to book.
          </p>
        </Match>
        <Match when={event.value()}>
          {(read) => (
            // Keyed on the profile: the picker captures it once, and a
            // refetched copy of the same event must not remount a booking
            // in flight.
            <Show when={read().profile.id} keyed>
              <BookingPicker
                profile={read().profile}
                event={read().event}
                source={source}
                preview={props.preview}
                onReceipt={context.booking.openReceipt}
              />
            </Show>
          )}
        </Match>
      </Switch>
    </section>
  );
}
