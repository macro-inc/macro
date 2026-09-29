type BrowserLocation = Pick<Location, 'host' | 'origin' | 'protocol'>;

export function passwordlessRedirectUri(location: BrowserLocation): string {
  const origin =
    location.protocol === 'http:' || location.protocol === 'https:'
      ? location.origin
      : `https://${location.host}`;
  return `${origin}/app`;
}
