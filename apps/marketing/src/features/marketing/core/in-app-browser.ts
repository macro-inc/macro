/**
 * Meta's in-app browsers (Instagram, Facebook, Threads), where paid social
 * lands. Signup can't finish there: Google refuses sign-in inside embedded
 * webviews, and nothing done there carries over to the visitor's own browser.
 */
export type InAppBrowser = {
  app: 'instagram' | 'facebook' | 'threads';
  platform: 'ios' | 'android' | 'unknown';
};

/** The Meta in-app browser this user agent belongs to, if any. */
export function detectInAppBrowser(
  userAgent: string,
  maxTouchPoints: number
): InAppBrowser | undefined {
  const app = inAppBrowserApp(userAgent);
  if (!app) return undefined;
  return { app, platform: platformOf(userAgent, maxTouchPoints) };
}

function inAppBrowserApp(userAgent: string): InAppBrowser['app'] | undefined {
  if (/\bInstagram\b/.test(userAgent)) return 'instagram';
  if (/\bBarcelona\b/.test(userAgent)) return 'threads';
  if (/\bFB(AN|AV|IOS|_IAB|4A)\b/.test(userAgent)) return 'facebook';
  return undefined;
}

function platformOf(
  userAgent: string,
  maxTouchPoints: number
): InAppBrowser['platform'] {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return 'ios';
  // iPadOS reports itself as a Mac; only the touch screen gives it away.
  if (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1) return 'ios';
  if (/\bAndroid\b/.test(userAgent)) return 'android';
  return 'unknown';
}

/**
 * A link the in-app browser hands to the system instead of loading itself.
 * iOS 17+ opens `x-safari-https://…` in Safari. Android resolves an
 * `intent://` view of the page to the default browser (or the Macro app, if
 * it claims the link), loading the page itself when nothing can.
 */
export function systemBrowserUrl(
  url: string,
  platform: Exclude<InAppBrowser['platform'], 'unknown'>
): string {
  if (platform === 'ios') return `x-safari-${url}`;
  const parsed = new URL(url);
  const scheme = parsed.protocol.replace(/:$/, '');
  return (
    `intent://${parsed.host}${parsed.pathname}${parsed.search}` +
    `#Intent;scheme=${scheme};action=android.intent.action.VIEW;` +
    `S.browser_fallback_url=${encodeURIComponent(url)};end`
  );
}
