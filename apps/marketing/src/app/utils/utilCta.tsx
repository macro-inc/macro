import type { JSX } from 'solid-js';
import { isServer } from 'solid-js/web';
import {
  detectInAppBrowser,
  systemBrowserUrl,
} from '../../features/marketing/core/in-app-browser';
import {
  DEMO_BOOKING_URL,
  journeyHref,
} from '../../features/marketing/core/navigation';
import { analytics } from './utilAnalytic';
import { buildAppUrl } from './utilBaseUrl';

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
 * A demo was booked in the site's dialog. Sends Meta the Lead the backend
 * sends for a cal.com demo booking (`crates/cal`). A demo is not an account,
 * so it is not CompleteRegistration.
 */
export const handleDemoBooked = (): void => {
  analytics.track('demo_booking_complete', {
    page_location: window.location.href,
  });
  analytics.trackMeta('Lead', {
    content_name: 'demo_meeting',
    content_category: 'cal_booking',
    value: 100,
    currency: 'USD',
  });
};

/** How long a system-browser handoff gets before the page loads in place. */
const HANDOFF_FALLBACK_MS = 1500;

/**
 * Opens an app path (signup) outside Meta's in-app browsers, where signup
 * can't finish. On iOS and Android the system browser takes it; if the page
 * is still showing after a moment (iOS before 17, or an app that ignores the
 * link) it loads in place. An in-app browser on an unknown platform gets a
 * new tab. Returns false in an ordinary browser, where the caller navigates
 * as usual. The ad parameters ride along, since the visitor's own browser
 * has none of this page's cookies.
 */
export const leaveInAppBrowser = (path: string): boolean => {
  const inApp = detectInAppBrowser(
    navigator.userAgent,
    navigator.maxTouchPoints
  );
  if (!inApp) return false;
  const url = buildAppUrl(path);
  analytics.track('in_app_browser_handoff', {
    app: inApp.app,
    platform: inApp.platform,
  });
  if (inApp.platform === 'unknown') {
    // `noopener` would make window.open return null even when it opened.
    const opened = window.open(url, '_blank');
    if (opened) opened.opener = null;
    else window.location.href = url;
    return true;
  }
  let left = false;
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') left = true;
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.location.href = systemBrowserUrl(url, inApp.platform);
  window.setTimeout(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (!left) window.location.href = url;
  }, HANDOFF_FALLBACK_MS);
  return true;
};

/**
 * Click handler for plain signup links: leaves the in-app browser, and
 * otherwise lets the link navigate in the same tab.
 */
export const handleSignupLinkClick = (
  event: MouseEvent,
  href: string
): void => {
  if (leaveInAppBrowser(href)) event.preventDefault();
};

/** Shared primary-CTA click handler: tracks the click, then routes to ctaHref(). */
export const handleCtaClick = (event: MouseEvent, buttonName: string): void => {
  event.preventDefault();
  analytics.track('app_redirect', {
    page_location: window.location.href,
    button_name: buttonName,
  });
  const href = ctaHref();
  if (leaveInAppBrowser(href)) return;
  window.location.href = href;
};

/** Retained as a slot for page components; the journey CTA has no provider icon. */
export function CtaIcon(_props: {
  size?: number;
  opacity?: number;
}): JSX.Element {
  return null;
}
