import linkify, { type Match } from 'linkify-it';
import { match } from 'ts-pattern';

export const strictLinkifier = new linkify(undefined, {
  fuzzyLink: false,
});

const commonTldLinkifier = new linkify(undefined, {
  fuzzyLink: true,
}).tlds(
  [
    'app',
    'biz',
    'ca',
    'co',
    'com',
    'dev',
    'edu',
    'gov',
    'info',
    'io',
    'me',
    'net',
    'org',
    'shop',
    'site',
    'store',
    'tv',
    'uk',
    'us',
    'xyz',
  ],
  false
);

const fuzzyLinkifier = new linkify(undefined, {
  fuzzyLink: true,
});

export type AutoLinkMatchMode = 'protocol' | 'common-tlds' | 'fuzzy';

function getAutoLinkifier(mode: AutoLinkMatchMode) {
  return match(mode)
    .with('common-tlds', () => commonTldLinkifier)
    .with('fuzzy', () => fuzzyLinkifier)
    .with('protocol', () => strictLinkifier)
    .exhaustive();
}

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const URL_SCHEME_PATTERN = /^([a-z][a-z\d+.-]*):/i;

/**
 * Normalize user-entered links and reject protocols that links must not open.
 * Bare hosts retain the existing behavior of defaulting to HTTPS.
 */
export function normalizeLinkUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // The URL parser ignores ASCII tabs and newlines in protocols. Use the same
  // view when detecting a scheme so values such as `java\nscript:` cannot be
  // mistaken for a bare host and rewritten as HTTPS.
  const schemeProbe = trimmed.replace(/[\t\n\r]/g, '');
  const schemeMatch = URL_SCHEME_PATTERN.exec(schemeProbe);
  const scheme = schemeMatch?.[1]?.toLowerCase();
  const remainder = schemeMatch ? schemeProbe.slice(schemeMatch[0].length) : '';
  const isHostWithPort =
    scheme !== undefined &&
    (scheme === 'localhost' || scheme.includes('.')) &&
    /^\d+(?:[/?#]|$)/.test(remainder);
  const candidate = scheme && !isHostWithPort ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!ALLOWED_LINK_PROTOCOLS.has(parsed.protocol)) return null;

    if (parsed.protocol === 'mailto:') return trimmed;

    const [basePath, ...queryParts] = candidate.split(/([#?])/);
    const encodedBase = basePath
      .split('/')
      .map((segment) =>
        segment.includes(':')
          ? segment
          : encodeURI(segment).replace(/%25([\da-f]{2})/gi, '%$1')
      )
      .join('/');
    return encodedBase + queryParts.join('');
  } catch {
    return null;
  }
}

export function findAutoLinkMatches(
  text: string,
  mode: AutoLinkMatchMode = 'protocol'
): Match[] {
  const linkifier = getAutoLinkifier(mode);
  if (!linkifier.test(text)) return [];
  const match = linkifier.match(text);
  if (!match) return [];
  const matches: Match[] = [];
  for (const candidate of match) {
    const url = normalizeLinkUrl(
      candidate.schema === '' ? candidate.raw : candidate.url
    );
    if (url) matches.push({ ...candidate, url });
  }
  return matches;
}

export function findNextAutoLinkMatch(
  text: string,
  mode: AutoLinkMatchMode = 'protocol'
): Match | null {
  return findAutoLinkMatches(text, mode)[0] ?? null;
}
