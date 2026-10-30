import { setCookie } from '@core/util/cookies';

/**
 * Ad parameters forwarded from the page that captured a mobile email onto the
 * desktop signup link. Keep this in step with `MobileWelcomeAttribution` in
 * the auth service and `ATTRIBUTION_PARAMS` on the marketing site.
 */
export const AD_ATTRIBUTION_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'twclid',
  'rdt_cid',
] as const;

/** Query parameter the desktop link always carries. */
export const SIGNUP_FLOW_PARAM = 'signup_flow';

/** Value that marks a signup started from the mobile email capture. */
export const MOBILE_EMAIL_SIGNUP_FLOW = 'mobile_email';

/**
 * One cookie for the whole set from the email link. Individual utm cookies
 * can still hold an older visit, and mixing those with this link would
 * attribute the signup to the wrong campaign.
 */
const MOBILE_EMAIL_ATTRIBUTION_COOKIE = 'macro_mobile_email_attribution';

/** How long the desktop link's parameters survive a closed tab, in days. */
const ATTRIBUTION_COOKIE_DAYS = 7;

const MAX_ATTRIBUTION_VALUE_CHARS = 512;

const acceptedAttributionValue = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].length > MAX_ATTRIBUTION_VALUE_CHARS) {
    return null;
  }
  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || (code >= 127 && code <= 159)) return null;
    if ('<>"\'`\\'.includes(char)) return null;
  }
  return trimmed;
};

const readCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const raw = trimmed.slice(prefix.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
};

const searchParams = (): URLSearchParams => {
  const search = new URLSearchParams(window.location.search);
  const hashIndex = window.location.hash.indexOf('?');
  if (hashIndex === -1) return search;
  const hashParams = new URLSearchParams(
    window.location.hash.slice(hashIndex + 1)
  );
  hashParams.forEach((value, key) => {
    if (!search.get(key)) search.set(key, value);
  });
  return search;
};

const recordFrom = (params: URLSearchParams): Record<string, string> => {
  const result: Record<string, string> = {};
  const flow = params.get(SIGNUP_FLOW_PARAM);
  if (flow === MOBILE_EMAIL_SIGNUP_FLOW) {
    result[SIGNUP_FLOW_PARAM] = MOBILE_EMAIL_SIGNUP_FLOW;
  }
  for (const key of AD_ATTRIBUTION_PARAMS) {
    const value = params.get(key);
    const accepted = value ? acceptedAttributionValue(value) : null;
    if (accepted) result[key] = accepted;
  }
  return result;
};

/**
 * Stores the email link's parameters before signup leaves for the identity
 * provider. No-ops unless this page is that link.
 */
export const rememberMobileEmailAttribution = (): void => {
  if (typeof document === 'undefined') return;
  const params = searchParams();
  if (params.get(SIGNUP_FLOW_PARAM) !== MOBILE_EMAIL_SIGNUP_FLOW) return;
  const kept = new URLSearchParams();
  kept.set(SIGNUP_FLOW_PARAM, MOBILE_EMAIL_SIGNUP_FLOW);
  for (const key of AD_ATTRIBUTION_PARAMS) {
    const accepted = acceptedAttributionValue(params.get(key) ?? '');
    if (accepted) kept.set(key, accepted);
  }
  setCookie(
    MOBILE_EMAIL_ATTRIBUTION_COOKIE,
    kept.toString(),
    ATTRIBUTION_COOKIE_DAYS
  );
};

/**
 * Ad parameters for a capture that is still on the phone: the current URL,
 * filled in from the utm cookies root preload already stores.
 */
export const adAttributionForCapture = (): Record<string, string> => {
  const found: Record<string, string> = {};
  if (typeof document === 'undefined') return found;
  for (const key of AD_ATTRIBUTION_PARAMS) {
    const fromCookie = readCookie(key);
    const accepted = fromCookie ? acceptedAttributionValue(fromCookie) : null;
    if (accepted) found[key] = accepted;
  }
  const params = searchParams();
  for (const key of AD_ATTRIBUTION_PARAMS) {
    const accepted = acceptedAttributionValue(params.get(key) ?? '');
    if (accepted) found[key] = accepted;
  }
  return found;
};

/**
 * Person properties for a desktop signup that followed the mobile email.
 * Null when this browser did not open that link.
 */
export const mobileEmailPersonProperties = (): {
  set: Record<string, string>;
  once: Record<string, string>;
} | null => {
  const live = recordFrom(searchParams());
  const storedRaw = readCookie(MOBILE_EMAIL_ATTRIBUTION_COOKIE);
  const stored = storedRaw ? recordFrom(new URLSearchParams(storedRaw)) : null;
  const attribution =
    live[SIGNUP_FLOW_PARAM] === MOBILE_EMAIL_SIGNUP_FLOW ? live : stored;
  if (
    !attribution ||
    attribution[SIGNUP_FLOW_PARAM] !== MOBILE_EMAIL_SIGNUP_FLOW
  ) {
    return null;
  }

  const set: Record<string, string> = {
    [SIGNUP_FLOW_PARAM]: MOBILE_EMAIL_SIGNUP_FLOW,
  };
  const once: Record<string, string> = {
    $initial_signup_flow: MOBILE_EMAIL_SIGNUP_FLOW,
  };
  for (const key of AD_ATTRIBUTION_PARAMS) {
    const value = attribution[key];
    if (!value) continue;
    set[key] = value;
    once[`$initial_${key}`] = value;
  }
  return { set, once };
};
