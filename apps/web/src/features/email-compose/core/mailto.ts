/** Recipients extracted from a mailto: URL. */
export type ParsedMailto = {
  to: string[];
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parses a mailto: URL into its recipients. Returns null for anything that
 * isn't a valid mailto: URL. Addresses come from the path
 * (`mailto:a@x.com,b@y.com`) plus the non-standard but common `?to=` param.
 */
export function parseMailto(href: string): ParsedMailto | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'mailto:') return null;

  const to = url.pathname
    .split(',')
    .map((addr) => safeDecode(addr).trim())
    .filter(Boolean);

  const toParam = url.searchParams.get('to');
  if (toParam) {
    to.push(
      ...toParam
        .split(',')
        .map((addr) => addr.trim())
        .filter(Boolean)
    );
  }

  return { to };
}
