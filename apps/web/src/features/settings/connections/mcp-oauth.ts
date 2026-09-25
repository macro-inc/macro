import { isTauri } from '@core/util/platform';
import { openExternalUrl } from '@core/util/url';

/** Open a blank tab during the click so later OAuth assign is not blocked. */
export function reserveOauthPopup(): Window | null {
  if (isTauri()) return null;
  const popup = window.open('about:blank', '_blank');
  if (popup) popup.opener = null;
  return popup;
}

export function assignOauthUrl(popup: Window | null, url: string) {
  if (popup && !popup.closed) {
    popup.location.href = url;
    return;
  }
  openExternalUrl(url);
}
