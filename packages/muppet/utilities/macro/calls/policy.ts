/**
 * What may be shown on a call. A shared screen is seen by everyone on the
 * call and kept in recordings, so a page that holds secrets, mail or money is
 * never shown, and neither is anything on this machine or its network. Pure,
 * except `safeUrl`, which resolves names.
 */
import { lookup } from 'node:dns/promises';

/** A rule's name, and what it matches. */
export type Rule = readonly [rule: string, pattern: RegExp];

export type Refused = { readonly ok: false; readonly rule: string };

/** A URL that may be shown, normalized, and its host. */
export type UrlVerdict =
  | { readonly ok: true; readonly host: string; readonly url: string }
  | Refused;

/** The one page that isn't on the web and may still be shown: what a new tab opens on. */
export const blankPage = 'about:blank';
const blankHost = 'blank';

/** Hosts never shown, by rule: what is signed in there is private. */
export const blockedHosts: readonly Rule[] = [
  [
    'mail',
    /(^|\.)(?:mail|webmail|inbox|gmail|outlook|hotmail|protonmail|proton|fastmail|agentmail|zoho|hey)\./i,
  ],
  ['secrets-manager', /(^|\.)(?:doppler\.com|vault\.hashicorp\.cloud)$/i],
  [
    'password-manager',
    /(^|\.)(?:1password|bitwarden|lastpass|dashlane|keepersecurity)\.com$/i,
  ],
  [
    'account-security',
    /^(?:accounts|myaccount)\.google\.com$|^id\.atlassian\.com$/i,
  ],
  ['billing', /^dashboard\.stripe\.com$|^billing\.stripe\.com$/i],
  [
    'metadata',
    /(^|\.)(?:metadata\.google\.internal|metadata|instance-data|169\.254\.169\.254)$/i,
  ],
];

/** Paths never shown, on any host: billing, keys and secrets pages. */
export const blockedPaths: readonly Rule[] = [
  ['billing', /\/(?:billing|invoices?|payments?|checkout)(?:\/|$)/i],
  [
    'account-security',
    /\/(?:settings\/(?:tokens|keys)|api-keys|secrets)(?:\/|$)/i,
  ],
];

const privateSuffixes = [
  '.localhost',
  '.local',
  '.internal',
  '.test',
  '.invalid',
  '.onion',
];

const privateIpv4 = (address: string): boolean => {
  const parts = address.split('.');
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)
  )
    return false;
  const [a = -1, b = -1] = parts.map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    // Carrier-grade NAT, which is where Tailscale's addresses are.
    (a === 100 && b >= 64 && b <= 127)
  );
};

const parsed = (raw: string): URL | undefined => {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
};

/** The path and the hash, decoded: a single-page app's route lives in the hash. */
const route = (url: URL): string | undefined => {
  try {
    return decodeURIComponent(
      `${url.pathname}${url.hash.replace(/^#/, '')}`.replace(/%25/gi, '%')
    );
  } catch {
    return undefined;
  }
};

/**
 * May this URL be on a shared screen? Never mail, secrets managers, password
 * managers, billing, account security or key pages, or anything private by
 * scheme or by literal address; `hosts` and `paths` replace the blocklists.
 * What a name resolves to is `safeUrl`'s to check.
 */
export const urlRule = (
  raw: string,
  {
    hosts = blockedHosts,
    paths = blockedPaths,
  }: {
    readonly hosts?: readonly Rule[];
    readonly paths?: readonly Rule[];
  } = {}
): UrlVerdict => {
  const url = parsed(raw);
  if (url === undefined) return { ok: false, rule: 'invalid-url' };
  if (url.href === blankPage)
    return { ok: true, url: url.href, host: blankHost };
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, rule: 'scheme' };
  if (url.username !== '' || url.password !== '')
    return { ok: false, rule: 'credentials' };
  const host = url.hostname
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  // WHATWG URL normalizes decimal, octal, and hex IPv4 before hostname reaches us.
  if (
    host === '' ||
    host === 'localhost' ||
    privateSuffixes.some((suffix) => host.endsWith(suffix)) ||
    privateIpv4(host) ||
    // An IPv6 literal is refused outright.
    host.includes(':')
  )
    return { ok: false, rule: 'private-host' };
  for (const [rule, pattern] of hosts)
    if (pattern.test(host)) return { ok: false, rule };
  const path = route(url);
  if (path === undefined) return { ok: false, rule: 'invalid-url' };
  for (const [rule, pattern] of paths)
    if (pattern.test(path)) return { ok: false, rule };
  return { ok: true, host, url: url.href };
};

/** What a hostname resolved to. A URL with an IPv6 literal is refused outright; a public site's AAAA record isn't. */
export const privateAddress = (ip: string): boolean => {
  const address = ip.toLowerCase();
  if (!address.includes(':')) return privateIpv4(address);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address)?.[1];
  if (mapped !== undefined) return privateIpv4(mapped);
  return (
    address === '::' ||
    address === '::1' ||
    /^f[cd]/.test(address) ||
    /^fe[89ab]/.test(address) ||
    address.startsWith('::ffff:') ||
    address.startsWith('64:ff9b:')
  );
};

/**
 * May this URL be loaded, by what its name resolves to as well? A name that
 * doesn't resolve, or resolves to anything private, is refused: a public name
 * can point at this machine.
 */
export const safeUrl = async (
  raw: string,
  rules?: Parameters<typeof urlRule>[1]
): Promise<boolean> => {
  const verdict = urlRule(raw, rules);
  if (!verdict.ok) return false;
  if (verdict.url === blankPage) return true;
  try {
    const addresses = await lookup(verdict.host, { all: true, verbatim: true });
    return (
      addresses.length > 0 &&
      addresses.every(({ address }) => !privateAddress(address))
    );
  } catch {
    return false;
  }
};
