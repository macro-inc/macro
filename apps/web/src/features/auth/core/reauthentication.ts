/** A fresh-login request must survive the trip to the identity provider. */
export function requiresReauthentication(url: URL): boolean {
  return (
    url.searchParams.get('prompt') === 'login' &&
    url.searchParams.get('max_age') === '0'
  );
}

/** Do not restart fresh login when the identity provider returns. */
export function reauthenticationReturnUrl(url: URL): string {
  const target = new URL(url);
  target.searchParams.delete('prompt');
  target.searchParams.delete('max_age');
  return target.toString();
}
