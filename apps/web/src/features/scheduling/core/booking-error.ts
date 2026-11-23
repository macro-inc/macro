/** A request rejected before a reservation was accepted. */
export class BookingRejectedError extends Error {}

/**
 * The link's public booking budget refused the request. That settles a first
 * send, but not a resend: an earlier send of the same request may have passed
 * the budget and still be reserving.
 */
export class BookingRateLimitedError extends BookingRejectedError {}

/** A reschedule the host's calendar refused; the booking kept its time. */
export class RescheduleRefusedError extends Error {}
