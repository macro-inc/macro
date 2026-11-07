import { type JSX, Match, Switch } from 'solid-js';
import { BookingPicker } from './components/booking-picker';
import type { Booking } from './core/types';
import {
  createPublicBookingSource,
  usePublicProfileQuery,
} from './queries/public';

/**
 * One event's booking picker, embedded in another page (onboarding's demo
 * step). Unlike the public booking page, a booking stays on the host page.
 */
export function InlineBooking(props: {
  profile: string;
  event: string;
  guestEmail?: string;
  onBooked: (booking: Booking) => void;
  /** Shown when the booking page or its event can't be loaded. */
  unavailable: JSX.Element;
}) {
  const profile = usePublicProfileQuery(() => props.profile);
  const source = createPublicBookingSource();
  // Cached data stays on screen through a failed refetch, keeping the form.
  const loaded = () => (profile.isPending ? undefined : profile.data);
  const event = () => loaded()?.eventTypes.find((e) => e.slug === props.event);
  const bookable = () => {
    const ready = loaded();
    const found = event();
    return ready && found ? { profile: ready, event: found } : undefined;
  };
  return (
    <Switch
      fallback={
        <p role="status" class="p-12 text-center text-sm text-ink-muted">
          Loading available times…
        </p>
      }
    >
      <Match when={(profile.isError && !loaded()) || (loaded() && !event())}>
        {props.unavailable}
      </Match>
      <Match when={bookable()}>
        {(ready) => (
          <BookingPicker
            profile={ready().profile}
            event={ready().event}
            source={source}
            guest={{ email: props.guestEmail }}
            onReceipt={(receipt) => props.onBooked(receipt.booking)}
          />
        )}
      </Match>
    </Switch>
  );
}
