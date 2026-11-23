import { isProductionMetaHost } from './metaHost';

const MAX_CLICK_ID_CHARS = 512;

/**
 * Meta browser and click ids from the pixel cookies. Sent with signup so the
 * server CompleteRegistration can match the ad click. Omitted off production
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
