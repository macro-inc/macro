import { Show } from 'solid-js';
import { BookingPicker } from '../components/booking-picker';
import { PublicBookingLayout } from '../components/public-booking-layout';
import { PublicBookingProfile } from '../components/public-booking-profile';
import type { BookingReceipt, PublicEvent, PublicProfile } from '../core/types';
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
    <main class="flex min-h-screen flex-col overflow-y-auto bg-panel">
      <PublicBookingLayout embedded={props.embedded}>
        <Show
          when={props.event}
          fallback={
            <PublicBookingProfile
              profile={props.profile}
              onEvent={props.onEvent}
            />
          }
        >
          {(event) => (
            <BookingPicker
              profile={props.profile}
              event={event()}
              source={props.source}
              onReceipt={props.onReceipt}
              onChooseEvent={
                props.profile.eventTypes.length > 1
                  ? () => props.onEvent('')
                  : undefined
              }
            />
          )}
        </Show>
      </PublicBookingLayout>
    </main>
  );
}
