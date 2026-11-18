/** No booking links in the fixture's mention menu. */
export function useBookingLinkMention() {
  return { bookingLinks: () => [], isLoading: () => false };
}
