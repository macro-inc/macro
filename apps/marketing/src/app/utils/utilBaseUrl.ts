import { resolveAppBaseUrl } from './appBaseUrl';

export const APP_BASE_URL = resolveAppBaseUrl(
  import.meta.env.VITE_APP_BASE_URL
);

export const GOOGLE_SSO_URL =
  import.meta.env.VITE_GOOGLE_SSO_URL ||
  'https://gateway.macro.com/auth/login/sso?idp_name=google_gmail';

// Ad-attribution params forwarded into the app, where rootPreload cookies them
// and PostHog picks them up as campaign properties.
const ATTRIBUTION_PARAMS = [
  'utm_campaign',
  'utm_source',
  'utm_medium',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'twclid',
  'rdt_cid',
];

const ATTRIBUTION_STORAGE_KEY = 'macro_attribution_params';

// Captured at module load: SPA navigation drops the query string, but the CTA
// click can come many route changes after the ad landing.
const captureAttributionParams = (): URLSearchParams => {
  try {
    const search = new URLSearchParams(window.location.search);
    const stored = new URLSearchParams(
      sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY) ?? ''
    );
    let dirty = false;
    for (const param of ATTRIBUTION_PARAMS) {
      const value = search.get(param);
      if (value) {
        stored.set(param, value);
        dirty = true;
      }
    }
    if (dirty)
      sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, stored.toString());
    return stored;
  } catch {
    return new URLSearchParams();
  }
};

let attributionParams = captureAttributionParams();

/** App URL (e.g. `/app/welcome`) with any captured attribution params appended. */
export const buildAppUrl = (path: string): string => {
  const url = new URL(`${APP_BASE_URL}${path}`);
  for (const [key, value] of attributionParams) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

/** Google SSO URL with any captured attribution params appended. */
export const buildGoogleSsoUrl = (): string => {
  const url = new URL(GOOGLE_SSO_URL);
  for (const [key, value] of attributionParams) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};
