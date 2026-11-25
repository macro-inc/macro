import { isTauri } from '@core/util/platform';
import { openExternalUrl } from '@core/util/url';

type ReserveOauthPopupOptions = {
  /**
   * Leave the tab linked to this one, so this one can still navigate or close
   * it once it shows another origin. Only for pages Macro chose: a linked
   * page can also navigate this tab.
   */
  keepOpener?: boolean;
};

/**
 * Open a blank tab during the click so a later OAuth assign is not blocked.
 * The tab is cut off from this one unless `keepOpener`; a cut-off tab on
 * another origin can no longer be navigated or closed from here.
 */
export function reserveOauthPopup(
  options: ReserveOauthPopupOptions = {}
): Window | null {
  if (isTauri()) return null;
  const popup = window.open('about:blank', '_blank');
  if (popup && !options.keepOpener) popup.opener = null;
  return popup;
}

export function assignOauthUrl(popup: Window | null, url: string) {
  if (popup && !popup.closed) {
    popup.location.href = url;
    return;
  }
  openExternalUrl(url);
}
