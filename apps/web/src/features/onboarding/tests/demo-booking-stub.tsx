import type { DemoBookingSlot } from '../views/demo-step';

/** Stands in for the scheduling booking picker, which needs the app's queries. */
export const renderDemoBookingStub: DemoBookingSlot = (actions) => (
  <section aria-label="Demo booking">
    <p>Booking as {actions.guestEmail}</p>
    <button
      type="button"
      onClick={() => actions.onBooked('2026-11-10T17:00:00.000Z')}
    >
      Book Tuesday 5pm
    </button>
  </section>
);
