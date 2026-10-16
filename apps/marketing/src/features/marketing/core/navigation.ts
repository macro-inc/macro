export const FEATURE_PAGES = [
  { href: '/email', label: 'Email' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/channels', label: 'Chat' },
  { href: '/documents', label: 'Docs' },
  { href: '/calls', label: 'Calls' },
  { href: '/crm', label: 'CRM' },
  { href: '/agents', label: 'Agents' },
  { href: '/github', label: 'GitHub' },
] as const;

export const RESOURCE_PAGES = [
  {
    href: 'https://www.youtube.com/channel/UCcn-1WTGff0X_RscGVtwljQ',
    label: 'Videos',
  },
  { href: 'https://docs.macro.com', label: 'Documentation' },
  { href: '/migrate', label: 'Migration guide' },
  { href: '/posts', label: 'Blog' },
] as const;

/** Macro team booking link: a live demo with whichever host is free. */
export const DEMO_BOOKING_URL =
  'https://macro.com/app/book/6de4003c-15e4-549f-b5a9-0e930bbf56e4/macro-demo';

const MOBILE_SIGNUP_HREF = '/mobile-signup';

/** Same test as the app's `isMobile()`: a touch-first, phone-width screen. */
function isPhoneBrowser() {
  return (
    window.innerWidth < 640 &&
    window.matchMedia?.('(pointer: coarse)').matches === true
  );
}

/**
 * Phones skip signup and leave an email on `/mobile-signup` instead. For links
 * whose href is fixed at prerender time; `/app/signup` redirects phones there
 * too, this just spares them the app download.
 */
export function routePhoneToMobileSignup(event: MouseEvent) {
  if (!isPhoneBrowser()) return;
  event.preventDefault();
  window.location.href = MOBILE_SIGNUP_HREF;
}

/** Full document navigation keeps the app and marketing CSS independent. */
export function journeyHref() {
  if (typeof window === 'undefined') return '/app/signup';
  if (isPhoneBrowser()) return MOBILE_SIGNUP_HREF;
  try {
    const active = JSON.parse(
      sessionStorage.getItem('onboarding-flow-step') ?? 'null'
    );
    if (active?.user && active?.step) return '/app/onboarding';
  } catch {
    // An old or unavailable storage record must not prevent navigation.
  }
  return '/app/signup';
}
