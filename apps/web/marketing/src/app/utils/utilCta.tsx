import type { JSX } from 'solid-js';
import { isServer } from 'solid-js/web';
import { journeyHref } from '../../../../src/features/marketing/core/navigation';
import { analytics, buildCalLinkWithAttribution } from './utilAnalytic';

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

/** cal.com event for a live Macro demo with the team. */
export const DEMO_BOOKING_URL = 'https://cal.com/team/macro/macro-demo-call';

/** Demo booking link with Meta attribution signals attached (see utilAnalytic). */
export const demoHref = (): string =>
  buildCalLinkWithAttribution(DEMO_BOOKING_URL);

/**
 * Shared "Book Demo" click handler. Tracks the click and lets the anchor's own
 * `target="_blank"` navigation proceed — no preventDefault, so cal.com opens in
 * a new tab and the site stays put. Same event name the app uses for its
 * pricing-page demo CTA (`demo_booking_open`), so both show up together.
 */
export const handleDemoClick = (buttonName: string): void => {
  analytics.track('demo_booking_open', {
    page_location: window.location.href,
    button_name: buttonName,
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
