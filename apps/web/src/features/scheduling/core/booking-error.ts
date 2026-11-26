/** A request rejected before a reservation was accepted. */
export class BookingRejectedError extends Error {}

/** A reschedule the host's calendar refused; the booking kept its time. */
export class RescheduleRefusedError extends Error {}
