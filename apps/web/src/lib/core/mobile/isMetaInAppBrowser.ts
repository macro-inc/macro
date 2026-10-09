import { isMobile } from './isMobile';

const STORAGE_KEY = 'macro:meta-mobile-signup';

/** Instagram, Facebook, and Messenger in-app browsers. */
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|FB4A|FBIOS|Messenger/i;

/**
 * True when this user agent is Meta's in-app browser (the Safari webview
 * Instagram and Facebook ads open).
 */
export function isMetaInAppUserAgent(userAgent: string): boolean {
  return IN_APP.test(userAgent);
}

/** Click ids and source tags Meta appends when an ad opens the browser. */
export function isMetaAdSearch(search: string): boolean {
  const params = new URLSearchParams(search);
  const source = (params.get('utm_source') ?? '').toLowerCase();
  return (
    params.has('fbclid') ||
    params.has('igshid') ||
    source === 'facebook' ||
    source === 'instagram' ||
    source === 'meta' ||
    source === 'ig'
  );
}

function rememberMetaMobileSignup() {
  try {
    sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Private mode still runs the flow for this page view.
  }
}

function rememberedMetaMobileSignup(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Sign-up traffic that should get the mobile workspace handoff instead of
 * the desktop flow: Meta's in-app browser, or a phone that arrived from a
 * Meta ad (including when the ad opens mobile Safari).
 */
export function isMetaMobileSignup(): boolean {
  if (typeof window === 'undefined') return false;
  // Local preview: /app/signup?meta-mobile=1. Production ads still use the
  // in-app browser or a Meta click id.
  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has('meta-mobile')
  ) {
    rememberMetaMobileSignup();
    return true;
  }
  if (isMetaInAppUserAgent(navigator.userAgent)) {
    rememberMetaMobileSignup();
    return true;
  }
  if (isMetaAdSearch(window.location.search) && isMobile()) {
    rememberMetaMobileSignup();
    return true;
  }
  return rememberedMetaMobileSignup();
}
