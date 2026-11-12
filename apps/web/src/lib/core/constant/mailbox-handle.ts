export const ROX_MAIL_DOMAIN = 'rox.one';

/** Service and operations names reserved by the Rox mail host. */
export const RESERVED_HANDLES: Record<string, true> = {
  postmaster: true,
  abuse: true,
  admin: true,
  administrator: true,
  root: true,
  support: true,
  noreply: true,
  'no-reply': true,
  dmarc: true,
  security: true,
  hostmaster: true,
  webmaster: true,
  'mailer-daemon': true,
  info: true,
  billing: true,
  help: true,
  rox: true,
  team: true,
  system: true,
  mail: true,
  www: true,
  api: true,
  mx: true,
  smtp: true,
  imap: true,
  jmap: true,
  autoconfig: true,
  autodiscover: true,
  'mta-sts': true,
  sales: true,
  legal: true,
  privacy: true,
  news: true,
  newsletter: true,
  bounce: true,
  bounces: true,
  devnull: true,
  nobody: true,
  test: true,
  official: true,
  staff: true,
  owner: true,
};

/** [a-z0-9._-], 3–32 chars, no leading/trailing dot, no `..`, not reserved. */
export function isAllowedHandle(handle: string): boolean {
  return (
    /^[a-z0-9._-]{3,32}$/.test(handle) &&
    !handle.startsWith('.') &&
    !handle.endsWith('.') &&
    !handle.includes('..') &&
    RESERVED_HANDLES[handle] !== true
  );
}

export function mailboxAddress(handle: string): string {
  return `${handle}@${ROX_MAIL_DOMAIN}`;
}
