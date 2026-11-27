import { hireReturnUrl } from './draft';
import { parseReturnIntent, returnPath } from './return-intent';

export function signInReturn(search: string): string {
  const params = new URLSearchParams(search);
  const returns = params.getAll('return');
  const handoffs = params.getAll('handoff');
  const destination = returns[0];

  // Tower destinations have no supplemental state or query string.
  if (
    params.size === 1 &&
    returns.length === 1 &&
    (destination === '/passwords' || destination === '/billing')
  ) {
    return destination;
  }

  params.delete('handoff');
  const intent = parseReturnIntent(params.toString());
  if (!intent) return '/';

  if (
    intent.route === 'creator' &&
    intent.action === 'hire' &&
    handoffs.length === 1 &&
    /^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(handoffs[0])
  ) {
    return hireReturnUrl(handoffs[0]);
  }
  if (
    handoffs.length > 0 ||
    (intent.route === 'creator' && intent.action === 'hire')
  )
    return '/';
  return returnPath(intent);
}
