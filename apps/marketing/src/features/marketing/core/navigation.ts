export const FEATURE_PAGES = [
  { guide: '/docs/product/email', href: '/email', label: 'Email' },
  { guide: '/docs/product/tasks', href: '/tasks', label: 'Tasks' },
  { guide: '/docs/product/channels', href: '/channels', label: 'Chat' },
  { guide: '/docs/product/docs', href: '/documents', label: 'Docs' },
  { guide: '/docs/product/calls', href: '/calls', label: 'Calls' },
  { guide: '/docs/product/crm', href: '/crm', label: 'CRM' },
  { guide: '/docs/product/agents', href: '/agents', label: 'Agents' },
  { guide: '/docs/product/databases', href: '/databases', label: 'Databases' },
  { guide: '/docs/product/calendar', href: '/calendar', label: 'Calendar' },
  { guide: '/docs/integrations/github', href: '/github', label: 'Coding' },
  { guide: '/docs/product/drive', href: '/drive', label: 'Drive' },
  {
    guide: '/docs/product/spreadsheets',
    href: '/spreadsheets',
    label: 'Sheets',
  },
  { guide: '/docs/product/forms', href: '/forms', label: 'Forms' },
  { guide: '/docs/product/canvas', href: '/canvas', label: 'Canvas' },
  { guide: '/docs/product/snippets', href: '/snippets', label: 'Snippets' },
  {
    guide: '/docs/product/booking-links',
    href: '/booking-links',
    label: 'Booking links',
  },
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

function readOnboardingFlowStep(): string | null {
  // Resolve each store inside the try: reading `window.localStorage` itself
  // throws when the browser blocks it.
  for (const storage of [() => localStorage, () => sessionStorage]) {
    try {
      const value = storage().getItem('onboarding-flow-step');
      if (value !== null) return value;
    } catch {
      // This store can be blocked; the other may still hold the step.
    }
  }
  return null;
}

/** Full document navigation keeps the app and marketing CSS independent. */
export function journeyHref() {
  if (typeof window === 'undefined') return '/app/signup';
  const raw = readOnboardingFlowStep();
  try {
    const active = JSON.parse(raw ?? 'null');
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
