import { getWebOrigin } from '@core/util/webOrigin';

/** Router-relative path for a persistent, shareable meeting. */
export function getMeetingPath(shareToken: string) {
  return `/meet/${encodeURIComponent(shareToken)}`;
}

/** Browser URL also usable outside the desktop application. */
export function getMeetingUrl(shareToken: string) {
  return `${getWebOrigin()}/app${getMeetingPath(shareToken)}`;
}

export function isMeetingPath(pathname: string) {
  return /^\/(?:app\/)?meet\/[^/]+\/?$/.test(pathname);
}
