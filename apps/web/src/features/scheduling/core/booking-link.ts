import type {
  CreateBookingLink,
  EditBookingLink,
} from '@service-cognition/generated/tools/types';

export type BookingLinkArgs = CreateBookingLink | EditBookingLink;

/** Complete the editable week; retain duplicate-day windows so validation can flag overlaps. */
export function editableBookingWeek(
  weekly: BookingLinkArgs['draft']['schedule']['weekly']
) {
  return Array.from({ length: 7 }, (_, day) => ({
    day,
    windows: weekly
      .filter((entry) => entry.day === day)
      .flatMap((entry) => entry.windows),
  }));
}
