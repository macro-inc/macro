import { getWebOrigin } from '@core/util/webOrigin';

/** Router-relative setup path used by a persistent meeting invitation. */
export function getMeetingPath(shareToken: string) {
  return `/meet/join/${encodeURIComponent(shareToken)}`;
}

/** Router-relative path while participating in a meeting. */
export function getActiveMeetingPath(shareToken: string) {
  return `/meet/${encodeURIComponent(shareToken)}`;
}

/** Browser URL also usable outside the desktop application. */
export function getMeetingUrl(shareToken: string) {
  return `${getWebOrigin()}/app${getMeetingPath(shareToken)}`;
}

export function isMeetingPath(pathname: string) {
  return (
    /^\/(?:app\/)?meet\/new\/?$/.test(pathname) ||
    meetingShareTokenFromPath(pathname) !== undefined
  );
}

function meetingShareTokenFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/(?:app\/)?meet\/(?:join\/)?([^/?#]+)\/?$/);
  if (!match) return undefined;
  try {
    const token = decodeURIComponent(match[1]);
    return token === 'new' || token === 'join' ? undefined : token;
  } catch {
    return undefined;
  }
}

/** Share token embedded in a meeting URL, for URLs not accompanied by a model. */
export function getMeetingShareToken(url: string): string | undefined {
  try {
    return meetingShareTokenFromPath(new URL(url, getWebOrigin()).pathname);
  } catch {
    return undefined;
  }
}
