/** Query parameters of the active browser or native hash route. */
export function authenticationParams(url: URL): URLSearchParams {
  const route = url.hash.startsWith('#/')
    ? new URL(url.hash.slice(1), url)
    : url;
  return route.searchParams;
}

/** A fresh-login request must survive the trip to the identity provider. */
export function requiresReauthentication(
  source: URL | URLSearchParams
): boolean {
  const params = source instanceof URL ? authenticationParams(source) : source;
  return params.get('prompt') === 'login' && params.get('max_age') === '0';
}

/** Do not restart fresh login when the identity provider returns. */
export function reauthenticationReturnUrl(url: URL): string {
  const target = new URL(url);
  target.searchParams.delete('prompt');
  target.searchParams.delete('max_age');
  if (target.hash.startsWith('#/')) {
    const route = new URL(target.hash.slice(1), target);
    route.searchParams.delete('prompt');
    route.searchParams.delete('max_age');
    target.hash = `${route.pathname}${route.search}${route.hash}`;
  }
  return target.toString();
}
