import { isTauri } from '@core/util/platform';
import { openExternalUrl } from '@core/util/url';
import type { ClaudeSignIn } from './core/connection';

/** Reserve a browser tab before awaiting auth; native shells use the system browser. */
export function openClaudeSignIn(): ClaudeSignIn | undefined {
  if (isTauri()) return { navigate: openExternalUrl, close: () => {} };

  let popup: Window | null = null;
  try {
    popup = window.open('about:blank', '_blank');
    if (!popup) return;
    popup.opener = null;
    const referrer = popup.document.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    popup.document.head.append(referrer);
    popup.document.title = 'Connecting to Claude…';
    popup.document.body.textContent = 'Preparing Claude sign-in…';
    const tab = popup;
    return {
      navigate: (url) => {
        if (!tab.closed) tab.location.replace(url);
      },
      close: () => tab.close(),
    };
  } catch {
    popup?.close();
    // The settings form retains a normal link when opening a tab is blocked.
    return;
  }
}
