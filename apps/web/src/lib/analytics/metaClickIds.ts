import { setCookie } from '@core/util/cookies';
import { isProductionMetaHost } from './metaHost';

const MAX_CLICK_ID_CHARS = 512;

/** How long the pixel itself keeps `_fbc`, in days. */
const CLICK_ID_COOKIE_DAYS = 90;

/**
 * Stores the ad click from a landing URL's `fbclid` as the `_fbc` cookie, in
 * the format Meta documents (`fb.1.<first seen ms>.<fbclid>`). The pixel
 * writes the same cookie, but only if it loads while `fbclid` is still in the
 * address bar; a blocked or slow pixel, or a signup that navigates away
 * first, would otherwise lose the click. A cookie already holding this click
 * keeps its original timestamp.
 */
export function rememberMetaClick(
  search = window.location.search,
  hostname = window.location.hostname
): void {
  if (typeof document === 'undefined') return;
  if (!isProductionMetaHost(hostname)) return;

  const fbclid = new URLSearchParams(search).get('fbclid')?.trim();
  if (!fbclid || !/^[A-Za-z0-9_-]+$/.test(fbclid)) return;
  if (readClickId('_fbc')?.endsWith(`.${fbclid}`)) return;

  const fbc = `fb.1.${Date.now()}.${fbclid}`;
  if (fbc.length > MAX_CLICK_ID_CHARS) return;
  setCookie('_fbc', fbc, CLICK_ID_COOKIE_DAYS);
}

/**
 * Meta browser and click ids from the pixel cookies. Sent with signup and
 * checkout so the server CompleteRegistration and Purchase can match the ad
 * click. Omitted off production
 * hosts, where the production pixel is not loaded.
 */
export function metaClickIds(hostname = window.location.hostname): {
  fbp?: string;
  fbc?: string;
} {
  if (typeof document === 'undefined') return {};
  if (!isProductionMetaHost(hostname)) return {};
  return {
    fbp: readClickId('_fbp'),
    fbc: readClickId('_fbc'),
  };
}

export function appendMetaClickIds(
  url: URL,
  hostname = window.location.hostname
): void {
  const { fbp, fbc } = metaClickIds(hostname);
  if (fbp) url.searchParams.set('fbp', fbp);
  if (fbc) url.searchParams.set('fbc', fbc);
}

export function metaClickHeaders(
  hostname = window.location.hostname
): Record<string, string> {
  const { fbp, fbc } = metaClickIds(hostname);
  return {
    ...(fbp ? { 'X-Macro-Fbp': fbp } : {}),
    ...(fbc ? { 'X-Macro-Fbc': fbc } : {}),
  };
}

function readClickId(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  if (!match?.[1]) return undefined;
  let value = match[1];
  try {
    value = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].length > MAX_CLICK_ID_CHARS) return undefined;
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return undefined;
  return trimmed;
}
