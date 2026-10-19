import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { Badge } from '@ui';
import { bookingIsPast } from '../core/booking-list';
import type { Booking } from '../core/types';

export function BookingStatus(props: { booking: Booking; class?: string }) {
  const label = () => {
    if (props.booking.status === 'pending') return 'Unconfirmed';
    if (props.booking.status === 'failed') return 'Calendar sync failed';
    if (props.booking.status === 'processing') return 'Syncing calendar';
    if (props.booking.status === 'cancelled') return 'Cancelled';
    if (props.booking.attendance === 'guestNoShow') return 'Guest no-show';
    if (props.booking.attendance === 'hostNoShow') return 'Host no-show';
    if (props.booking.attendance === 'attended') return 'Attended';
    return bookingIsPast(props.booking, Date.now()) ? 'Ended' : 'Confirmed';
  };
  return (
    <Badge
      variant="outline"
      size="md"
      class={propertyPillClasses({
        variant: 'outline',
        size: 'md',
        readOnly: true,
        class: props.class,
      })}
      classList={{
        'text-success':
          props.booking.status === 'confirmed' &&
          (props.booking.attendance === 'attended' ||
            !bookingIsPast(props.booking, Date.now())),
        'text-warning':
          props.booking.status === 'pending' ||
          props.booking.status === 'processing',
        'text-failure':
          props.booking.status !== 'cancelled' &&
          (props.booking.status === 'failed' ||
            props.booking.attendance === 'guestNoShow' ||
            props.booking.attendance === 'hostNoShow'),
      }}
    >
      <span
        aria-hidden="true"
        class="size-1.5 shrink-0 rounded-full bg-current"
      />
      <span class="min-w-0 break-words">{label()}</span>
    </Badge>
  );
}
