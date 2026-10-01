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

/** Full document navigation keeps the app and marketing CSS independent. */
export function journeyHref() {
  if (typeof window === 'undefined') return '/start';
  try {
    const active = JSON.parse(
      sessionStorage.getItem('onboarding-flow-step') ?? 'null'
    );
    if (active?.user && active?.step) return '/app/onboarding';
  } catch {
    // An old or unavailable storage record must not prevent navigation.
  }
  return '/start';
}
