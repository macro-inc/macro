/**
 * What human check a page shows, from facts read off it: which provider,
 * and for the ones CapSolver solves as a token (reCAPTCHA v2 and v3,
 * Turnstile), the parameters a solve needs. Pure: the facts come from
 * `page.ts`, which only reads the page and never touches a widget.
 */

/** One element carrying a `data-sitekey`, as the page has it. */
export type Widget = {
  readonly className: string;
  readonly siteKey: string;
  /** `data-size`: `invisible` for an invisible reCAPTCHA. */
  readonly size?: string;
  readonly action?: string;
  readonly cdata?: string;
  /** `data-s`, which some reCAPTCHA v2 sites set. */
  readonly dataS?: string;
  /** `data-callback`: the global function the page runs with the token. */
  readonly callback?: string;
};

/** What `page.ts` reads: nothing of the page's text beyond its title. */
export type PageFacts = {
  readonly url: string;
  readonly title: string;
  readonly widgets: readonly Widget[];
  /** Every frame's URL, the page's own first. */
  readonly frames: readonly string[];
  /** Every script's `src`. */
  readonly scripts: readonly string[];
  /** Ids and classes of elements that only a challenge page has. */
  readonly markers: readonly string[];
};

/** A challenge CapSolver solves as a token, with what its task needs. */
export type Challenge =
  | {
      readonly kind: 'recaptchaV2';
      readonly siteKey: string;
      readonly invisible: boolean;
      readonly enterprise: boolean;
      readonly dataS?: string;
      readonly action?: string;
    }
  | {
      readonly kind: 'recaptchaV3';
      readonly siteKey: string;
      readonly enterprise: boolean;
      readonly action?: string;
    }
  | {
      readonly kind: 'turnstile';
      readonly siteKey: string;
      readonly action?: string;
      readonly cdata?: string;
    };

/** Checks the solver doesn't take: they go to the owner. */
export type UnsupportedProvider =
  | 'cloudflareChallenge'
  | 'hcaptcha'
  | 'datadome'
  | 'awsWaf'
  | 'geetest'
  | 'arkose'
  | 'perimeterx'
  | 'friendlyCaptcha'
  | 'mtcaptcha';

export type Detection =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'supported';
      readonly challenge: Challenge;
      /** The page's own callback for the token, when the widget names one. */
      readonly callback?: string;
    }
  | { readonly kind: 'unsupported'; readonly provider: UnsupportedProvider };

const parsed = (url: string): URL | undefined => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

const recaptchaHosts = new Set([
  'www.google.com',
  'google.com',
  'www.recaptcha.net',
  'recaptcha.net',
]);

/** A reCAPTCHA anchor frame: `…/recaptcha/(api2|enterprise)/anchor?k=<site key>`. */
const anchorFrame = (frame: URL): Challenge | undefined => {
  if (!recaptchaHosts.has(frame.host)) return undefined;
  const match = /^\/recaptcha\/(api2|enterprise)\/anchor$/.exec(frame.pathname);
  const siteKey = frame.searchParams.get('k');
  if (match === null || siteKey === null || siteKey === '') return undefined;
  return {
    kind: 'recaptchaV2',
    siteKey,
    invisible: frame.searchParams.get('size') === 'invisible',
    enterprise: match[1] === 'enterprise',
  };
};

/** reCAPTCHA v3 loads `api.js?render=<site key>` (or `enterprise.js`), with no widget. */
const v3Script = (script: URL): Challenge | undefined => {
  if (!recaptchaHosts.has(script.host)) return undefined;
  const match = /^\/recaptcha\/(api|enterprise)\.js$/.exec(script.pathname);
  const siteKey = script.searchParams.get('render');
  if (
    match === null ||
    siteKey === null ||
    siteKey === '' ||
    siteKey === 'explicit'
  )
    return undefined;
  return {
    kind: 'recaptchaV3',
    siteKey,
    enterprise: match[1] === 'enterprise',
  };
};

/** Turnstile's frame carries its site key as a path segment: `…/0x4AAAA…/…`. */
const turnstileFrame = (frame: URL): Challenge | undefined => {
  if (frame.host !== 'challenges.cloudflare.com') return undefined;
  const siteKey = frame.pathname
    .split('/')
    .find((segment) => /^0x[0-9A-Za-z_-]{8,}$/.test(segment));
  return siteKey === undefined ? undefined : { kind: 'turnstile', siteKey };
};

const enterpriseLoaded = (scripts: readonly URL[]): boolean =>
  scripts.some(
    (script) =>
      recaptchaHosts.has(script.host) &&
      script.pathname === '/recaptcha/enterprise.js'
  );

const classes = (widget: Widget): readonly string[] =>
  widget.className.split(/\s+/).filter((name) => name !== '');

const optional = <Key extends string>(
  key: Key,
  value: string | undefined
): Partial<Record<Key, string>> =>
  value === undefined || value === ''
    ? {}
    : ({ [key]: value } as Record<Key, string>);

/** A widget element as a challenge, by its class. */
const widgetChallenge = (
  widget: Widget,
  enterprise: boolean
): Challenge | undefined => {
  const names = classes(widget);
  if (names.includes('cf-turnstile'))
    return {
      kind: 'turnstile',
      siteKey: widget.siteKey,
      ...optional('action', widget.action),
      ...optional('cdata', widget.cdata),
    };
  if (names.includes('g-recaptcha'))
    return {
      kind: 'recaptchaV2',
      siteKey: widget.siteKey,
      invisible: widget.size === 'invisible',
      enterprise,
      ...optional('dataS', widget.dataS),
      ...optional('action', widget.action),
    };
  return undefined;
};

/**
 * Hosts and markers of the checks the solver leaves to the owner, most
 * specific first. A Cloudflare interstitial ("Just a moment…") runs
 * Turnstile inside it, but CapSolver solves it only through a proxy, so it
 * is checked before Turnstile is.
 */
const unsupportedBy: ReadonlyArray<{
  readonly provider: UnsupportedProvider;
  readonly hosts: readonly string[];
  readonly markers: readonly string[];
}> = [
  {
    provider: 'hcaptcha',
    hosts: ['hcaptcha.com'],
    markers: ['h-captcha'],
  },
  {
    provider: 'datadome',
    hosts: ['captcha-delivery.com', 'datadome.co'],
    markers: [],
  },
  { provider: 'awsWaf', hosts: ['awswaf.com'], markers: ['aws-waf-token'] },
  { provider: 'geetest', hosts: ['geetest.com'], markers: ['geetest_captcha'] },
  {
    provider: 'arkose',
    hosts: ['arkoselabs.com', 'funcaptcha.com'],
    markers: [],
  },
  {
    provider: 'perimeterx',
    hosts: ['perimeterx.net', 'px-cloud.net', 'px-cdn.net'],
    markers: ['px-captcha'],
  },
  {
    provider: 'friendlyCaptcha',
    hosts: ['friendlycaptcha.com'],
    markers: ['frc-captcha'],
  },
  { provider: 'mtcaptcha', hosts: ['mtcaptcha.com'], markers: ['mtcaptcha'] },
];

const onHost = (url: URL, host: string): boolean =>
  url.host === host || url.host.endsWith(`.${host}`);

/** Cloudflare's interstitial: its title, its form, or its challenge query. */
const interstitial = (facts: PageFacts, page: URL | undefined): boolean =>
  /^just a moment/i.test(facts.title.trim()) ||
  facts.markers.includes('challenge-form') ||
  facts.markers.includes('cf-chl-widget') ||
  (page?.searchParams.has('__cf_chl_rt_tk') ?? false);

/** What check, if any, the page shows. */
export const detect = (facts: PageFacts): Detection => {
  const page = parsed(facts.url);
  if (interstitial(facts, page))
    return { kind: 'unsupported', provider: 'cloudflareChallenge' };

  const frames = facts.frames.flatMap((frame) => parsed(frame) ?? []);
  const scripts = facts.scripts.flatMap((script) => parsed(script) ?? []);
  const loaded = [...frames, ...scripts];
  const enterprise = enterpriseLoaded(scripts);

  // A widget on the page is the most direct evidence, and names its callback.
  for (const widget of facts.widgets) {
    const challenge = widgetChallenge(widget, enterprise);
    if (challenge !== undefined)
      return {
        kind: 'supported',
        challenge,
        ...optional('callback', widget.callback),
      };
  }

  for (const frame of frames) {
    const challenge = anchorFrame(frame) ?? turnstileFrame(frame);
    if (challenge !== undefined) return { kind: 'supported', challenge };
  }

  for (const { provider, hosts, markers } of unsupportedBy) {
    const byHost = loaded.some((url) =>
      hosts.some((host) => onHost(url, host))
    );
    const byMarker = markers.some((marker) => facts.markers.includes(marker));
    if (byHost || byMarker) return { kind: 'unsupported', provider };
  }

  for (const script of scripts) {
    const challenge = v3Script(script);
    if (challenge !== undefined) return { kind: 'supported', challenge };
  }

  return { kind: 'none' };
};

/** The page URL a solve sends: origin and path, never the query or fragment. */
export const solvePageUrl = (url: string): string | undefined => {
  const page = parsed(url);
  if (page === undefined) return undefined;
  if (page.protocol !== 'https:' && page.protocol !== 'http:') return undefined;
  return `${page.origin}${page.pathname}`;
};
