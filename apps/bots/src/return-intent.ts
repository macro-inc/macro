export type ReturnIntent =
  | { route: 'creator'; action: 'edit' | 'hire' }
  | { route: 'fleet' | 'passwords' | 'billing' };

export const editIntent: ReturnIntent = { route: 'creator', action: 'edit' };
export const hireIntent: ReturnIntent = { route: 'creator', action: 'hire' };
export const fleetIntent: ReturnIntent = { route: 'fleet' };
export const passwordsIntent: ReturnIntent = { route: 'passwords' };
export const billingIntent: ReturnIntent = { route: 'billing' };

const returnPaths = new Map<string, ReturnIntent>([
  ['/', editIntent],
  ['/?intent=hire', hireIntent],
  ['/fleet', fleetIntent],
  ['/passwords', passwordsIntent],
  ['/billing', billingIntent],
]);

export function returnPath(intent: ReturnIntent): string {
  if (intent.route !== 'creator') return `/${intent.route}`;
  return intent.action === 'hire' ? '/?intent=hire' : '/';
}

export function parseReturnIntent(search: string): ReturnIntent | undefined {
  // Compare exact decoded values without normalizing attacker-controlled paths.
  const params = new URLSearchParams(search);
  const entries = [...params];
  if (entries.length !== 1 || entries[0][0] !== 'return') return undefined;

  return returnPaths.get(entries[0][1]);
}

export function buildSignInUrl(intent: ReturnIntent, handoff?: string): string {
  const search = new URLSearchParams({ return: returnPath(intent) });
  if (handoff) search.set('handoff', handoff);
  return `/sign-in?${search}`;
}

export function isHireHandoff(value: string | undefined): value is string {
  return !!value && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
}

export function macroLoginPath(intent: ReturnIntent, handoff?: string): string {
  const search = new URLSearchParams({
    return: intent.route === 'creator' ? 'bots' : `bots-${intent.route}`,
  });
  if (
    intent.route === 'creator' &&
    intent.action === 'hire' &&
    isHireHandoff(handoff)
  ) {
    search.set('handoff', handoff);
  }
  return `/app/login?${search}`;
}
