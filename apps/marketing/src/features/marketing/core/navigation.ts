export const FEATURE_PAGES = [
  { guide: '/docs/product/email', href: '/email', label: 'Email' },
  { guide: '/docs/product/tasks', href: '/tasks', label: 'Tasks' },
  { guide: '/docs/product/channels', href: '/channels', label: 'Chat' },
  { guide: '/docs/product/docs', href: '/documents', label: 'Docs' },
  { guide: '/docs/product/calls', href: '/calls', label: 'Calls' },
  { guide: '/docs/product/crm', href: '/crm', label: 'CRM' },
  { guide: '/docs/product/agents', href: '/agents', label: 'Agents' },
  {
    guide: '/docs/integrations/github',
    href: '/github',
    label: 'Pull requests',
  },
  {
    guide: '/docs/product/spreadsheets',
    href: '/spreadsheets',
    label: 'Spreadsheets',
  },
  { guide: '/docs/product/databases', href: '/databases', label: 'Databases' },
  { guide: '/docs/product/canvas', href: '/canvas', label: 'Canvas' },
  { guide: '/docs/product/snippets', href: '/snippets', label: 'Snippets' },
  { guide: '/docs/product/calendar', href: '/calendar', label: 'Calendar' },
  {
    guide: '/docs/product/booking-links',
    href: '/booking-links',
    label: 'Booking links',
  },
  { guide: '/docs/product/drive', href: '/drive', label: 'Drive' },
  { guide: '/docs/product/routines', href: '/routines', label: 'Routines' },
  { guide: '/docs/product/skills', href: '/skills', label: 'Skills' },
] as const;

export const RESOURCE_PAGES = [
  {
    href: 'https://www.youtube.com/channel/UCcn-1WTGff0X_RscGVtwljQ',
    label: 'Videos',
  },
  { href: '/docs', label: 'Documentation' },
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

/** Detailed guides remain directly accessible; each product appears once in navigation. */
export const FEATURE_GUIDE_ALIASES: Record<string, string> = {
  '/docs/product/projects': '/tasks',
  '/docs/product/folders': '/drive',
  '/docs/product/reviews': '/github',
};
export function featureHrefForGuide(href: string) {
  return (
    FEATURE_PAGES.find((page) => page.guide === href)?.href ??
    FEATURE_GUIDE_ALIASES[href]
  );
}
