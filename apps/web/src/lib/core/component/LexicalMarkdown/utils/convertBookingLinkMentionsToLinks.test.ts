// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { convertBookingLinkMentionsToLinks } from './convertBookingLinkMentionsToLinks';

function convert(html: string) {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  convertBookingLinkMentionsToLinks(body);
  return { body, link: body.querySelector('a') };
}

describe('convertBookingLinkMentionsToLinks', () => {
  it('converts a booking link mention span to an anchor tag', () => {
    const { link } = convert(
      '<span data-booking-link-mention="true" data-booking-profile-id="abc123" data-booking-slug="30min" data-booking-label="30 Minute Meeting" data-booking-url="https://macro.com/app/book/abc123/30min">30 Minute Meeting</span>'
    );

    expect(link).not.toBeNull();
    expect(link?.href).toBe('https://macro.com/app/book/abc123/30min');
    expect(link?.textContent).toBe('30 Minute Meeting');
    expect(link?.getAttribute('data-booking-link-mention')).toBe('true');
    expect(link?.getAttribute('data-booking-profile-id')).toBe('abc123');
    expect(link?.getAttribute('data-booking-slug')).toBe('30min');
    expect(link?.getAttribute('data-booking-label')).toBe('30 Minute Meeting');
    expect(link?.getAttribute('data-booking-url')).toBe(
      'https://macro.com/app/book/abc123/30min'
    );
  });

  it('uses slug as fallback label when label is missing', () => {
    const { link } = convert(
      '<span data-booking-link-mention="true" data-booking-profile-id="abc123" data-booking-slug="quick-call" data-booking-url="https://macro.com/app/book/abc123/quick-call">quick-call</span>'
    );

    expect(link?.textContent).toBe('quick-call');
  });

  it('uses text content as fallback when label and slug are missing', () => {
    const { link } = convert(
      '<span data-booking-link-mention="true" data-booking-profile-id="abc123" data-booking-url="https://macro.com/app/book/abc123">Book a meeting</span>'
    );

    expect(link?.textContent).toBe('Book a meeting');
  });

  it('skips elements without a booking URL', () => {
    const { link } = convert(
      '<span data-booking-link-mention="true" data-booking-profile-id="abc123">Missing URL</span>'
    );

    expect(link).toBeNull();
  });

  it('does not add slug attribute when slug is empty', () => {
    const { link } = convert(
      '<span data-booking-link-mention="true" data-booking-profile-id="abc123" data-booking-slug="" data-booking-url="https://macro.com/app/book/abc123">Booking link</span>'
    );

    expect(link?.hasAttribute('data-booking-slug')).toBe(false);
  });
});
