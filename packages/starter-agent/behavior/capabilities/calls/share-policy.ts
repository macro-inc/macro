/**
 * Every rule about what the agent may show on a call. Pure: a URL and the
 * share's state go in, a verdict comes out.
 *
 * A share shows everything on it to everyone on the call and into
 * recordings. So it is always a clean browser with nothing signed in, and
 * the blocklist below has no override for anyone.
 */

export type Refused = { readonly ok: false; readonly rule: string };

/** A URL that may be shown, normalized, and the host that is said out loud. */
export type UrlVerdict =
  | { readonly ok: true; readonly host: string; readonly url: string }
  | Refused;

/** A request to start sharing, with the facts the rules need. */
export type Start = {
  readonly url: string;
  /** The agent joined this call uninvited. */
  readonly uninvited: boolean;
  /** A share is already up, or starting. */
  readonly active: boolean;
};

/** The one page that isn't on the web and may still be shown: what a new tab opens on. */
export const blankPage = 'about:blank';
const blankHost = 'blank';

const domains: readonly (readonly [rule: string, pattern: RegExp])[] = [
  [
    'mail',
    /(^|\.)(?:mail|webmail|inbox|gmail|outlook|hotmail|protonmail|proton|fastmail|agentmail|zoho|hey)\./i,
  ],
  ['doppler', /(^|\.)doppler\.com$/i],
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

const paths: readonly (readonly [rule: string, pattern: RegExp])[] = [
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
 * May this URL be on a shared screen? No override: mail, the secrets
 * manager, password managers, billing, login and key pages, and anything
 * private by scheme or by literal address. What a name resolves to is
 * `privateAddress`, asked at the wire.
 */
export const urlRule = (raw: string): UrlVerdict => {
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
  for (const [rule, pattern] of domains)
    if (pattern.test(host)) return { ok: false, rule };
  const path = route(url);
  if (path === undefined) return { ok: false, rule: 'invalid-url' };
  for (const [rule, pattern] of paths)
    if (pattern.test(path)) return { ok: false, rule };
  return { ok: true, host, url: url.href };
};

/** May the agent start sharing this? Never when it joined uninvited, and one share at a time. */
export const startRule = ({ url, uninvited, active }: Start): UrlVerdict => {
  if (uninvited) return { ok: false, rule: 'uninvited' };
  if (active) return { ok: false, rule: 'already-sharing' };
  return urlRule(url);
};

/** The screen can be driven only while a share is up. */
export const driveRule = (active: boolean): { readonly ok: true } | Refused =>
  active ? { ok: true } : { ok: false, rule: 'no-share' };

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
 * May this URL be loaded, by what its name resolves to as well? `resolve`
 * gives a hostname's addresses. A name that doesn't resolve, or resolves to
 * anything private, is refused: a public name can point at this machine.
 */
export const safeUrl =
  (resolve: (host: string) => Promise<readonly string[]>) =>
  async (raw: string): Promise<boolean> => {
    const verdict = urlRule(raw);
    if (!verdict.ok) return false;
    if (verdict.url === blankPage) return true;
    try {
      const addresses = await resolve(verdict.host);
      return (
        addresses.length > 0 &&
        addresses.every((address) => !privateAddress(address))
      );
    } catch {
      return false;
    }
  };
