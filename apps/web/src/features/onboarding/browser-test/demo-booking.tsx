import { BookingPicker } from '@app/features/scheduling/components/booking-picker';
import type {
  BookingRequest,
  PublicEvent,
  PublicProfile,
} from '@app/features/scheduling/core/types';
import type { BookingSource } from '@app/features/scheduling/primitives/booking-flow';
import type { DemoBookingSlot } from '../views/demo-step';

const DEMO_EVENT: PublicEvent = {
  id: 'demo-event',
  title: 'Macro demo',
  slug: 'macro-demo',
  description: 'A live walkthrough of Macro with our team.',
  durationMinutes: 30,
  location: '',
  macroCall: true,
  googleMeet: false,
  questions: [],
  requiresConfirmation: false,
  mode: 'roundRobin',
};
const DEMO_PROFILE: PublicProfile = {
  id: 'macro-team',
  name: 'Macro',
  description: '',
  eventTypes: [DEMO_EVENT],
};

/** Three half-hour slots every afternoon, in the guest's own time zone. */
const DEMO_SOURCE: BookingSource = {
  slots: async (_profile, _event, date) =>
    [13, 14, 15].map((hour) => ({
      startsAt: new Date(`${date}T${hour}:00:00`).toISOString(),
      endsAt: new Date(`${date}T${hour}:30:00`).toISOString(),
    })),
  book: async (_profile, _event, request: BookingRequest) => ({
    token: 'fixture-token',
    scheduleTimeZone: request.timeZone,
    booking: {
      id: 'fixture-booking',
      eventTypeId: DEMO_EVENT.id,
      title: DEMO_EVENT.title,
      name: request.name,
      email: request.email,
      startsAt: request.startsAt,
      endsAt: request.startsAt,
      timeZone: request.timeZone,
      hosts: [],
      status: 'confirmed',
      attendance: 'unknown',
      rescheduleCount: 0,
      rescheduledAt: null,
      location: '',
      answers: request.answers,
    },
  }),
};

/** The real booking picker over fixed availability, as onboarding hosts it. */
export const renderFixtureDemoBooking: DemoBookingSlot = (actions) => (
  <BookingPicker
    profile={DEMO_PROFILE}
    event={DEMO_EVENT}
    source={DEMO_SOURCE}
    guest={{ email: actions.guestEmail }}
    onReceipt={(receipt) => actions.onBooked(receipt.booking.startsAt)}
  />
);
