import type { JSX } from 'solid-js';
import { isServer } from 'solid-js/web';
import {
  DEMO_BOOKING_URL,
  journeyHref,
} from '../../features/marketing/core/navigation';
import { analytics } from './utilAnalytic';

// Mobile/touch browsers (phones, touch tablets). Signing up + onboarding on a
// phone is a poor experience, so these visitors get the site's own email
// capture instead — it takes their email and sends them a link to open Macro on
// desktop.
//
// Mirrors the app's `isTouchDevice()` (`pointer: coarse`) so the site and the
// app agree on who counts as "mobile web".
const detectMobileWebDevice = (): boolean => {
  if (isServer) return false;
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
};

const mobileWebDevice = detectMobileWebDevice();

/** True when the visitor is on a mobile/touch browser. */
export const isMobileWebDevice = (): boolean => mobileWebDevice;

/** Public CTAs resume the journey on every device. */
export const ctaHref = (): string => journeyHref();
export const ctaLabel = (_webLabel: string): string => 'Get started';

/** Booking page for a live Macro demo with the team. */
export const demoHref = (): string => DEMO_BOOKING_URL;

/**
 * Shared "Book Demo" click handler. Tracks the click and leaves the link to
 * `DemoBookingDialog`, which opens the booking page over the site on a plain
 * click; a new-tab click follows the link. Same event name the app uses for
 * its pricing-page demo CTA (`demo_booking_open`), so both show up together.
 */
export const handleDemoClick = (buttonName: string): void => {
  analytics.track('demo_booking_open', {
    page_location: window.location.href,
    button_name: buttonName,
  });
};

/**
 * A demo was booked in the site's dialog. Sends Meta the conversion the backend
 * sent for a cal.com demo booking (`crates/cal`), so campaigns that count demos
 * keep counting them.
 */
export const handleDemoBooked = (): void => {
  analytics.track('demo_booking_complete', {
    page_location: window.location.href,
  });
  analytics.trackMeta('CompleteRegistration', {
    content_name: 'demo_meeting',
    content_category: 'cal_booking',
    value: 100,
    currency: 'USD',
  });
};

/** Shared primary-CTA click handler: tracks the click, then routes to ctaHref(). */
export const handleCtaClick = (event: MouseEvent, buttonName: string): void => {
  event.preventDefault();
  analytics.track('app_redirect', {
    page_location: window.location.href,
    button_name: buttonName,
  });

  window.location.href = ctaHref();
};

/** Retained as a slot for page components; the journey CTA has no provider icon. */
export function CtaIcon(_props: {
  size?: number;
  opacity?: number;
}): JSX.Element {
  return null;
}
