/** Replace Macro booking-link-mention elements with portable HTML links. */
export function convertBookingLinkMentionsToLinks(root: ParentNode): void {
  const mentionElements = root.querySelectorAll<HTMLElement>(
    '[data-booking-link-mention="true"]'
  );

  mentionElements.forEach((element) => {
    const url = element.getAttribute('data-booking-url');
    const label =
      element.getAttribute('data-booking-label') ||
      element.getAttribute('data-booking-slug') ||
      element.textContent ||
      'Booking link';

    if (!url) return;

    const link = document.createElement('a');
    link.href = url;
    link.textContent = label;

    // Preserve mention data attributes so importing this HTML into Macro can
    // recreate the richer Lexical node.
    link.setAttribute('data-booking-link-mention', 'true');
    link.setAttribute(
      'data-booking-profile-id',
      element.getAttribute('data-booking-profile-id') || ''
    );
    const slug = element.getAttribute('data-booking-slug');
    if (slug) link.setAttribute('data-booking-slug', slug);
    const bookingLabel = element.getAttribute('data-booking-label');
    if (bookingLabel) link.setAttribute('data-booking-label', bookingLabel);
    link.setAttribute('data-booking-url', url);

    element.replaceWith(link);
  });
}
