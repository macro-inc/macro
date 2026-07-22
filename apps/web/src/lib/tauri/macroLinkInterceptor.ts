import { parseInternalAppLink } from '@core/util/macroAppUrl';
import { isTauri } from '@core/util/platform';
import { registerExternalUrlInterceptor } from '@core/util/url';
import { emit } from '@tauri-apps/api/event';

/**
 * `openExternalUrl` interceptor: inside the native Tauri shell, routes a Macro
 * `/app` link in-app via the same `navigate` event the deep-link handler emits,
 * instead of letting it fall through to `window.open` — which bypasses the
 * webview's navigation hook and would open the link in the system browser.
 *
 * Returns false for non-Tauri and non-Macro-`/app` URLs so `openExternalUrl`
 * keeps handling them.
 */
export function openMacroLinkInApp(url: string): boolean {
  if (!isTauri()) return false;
  const parsed = parseInternalAppLink(url);
  if (!parsed) return false;
  emit('navigate', parsed).catch((e) => {
    console.error('failed to emit navigate event for macro link', e);
    // The navigate event never dispatched, so nothing routed in-app. Fall back
    // to the system browser rather than leaving the link silently unhandled
    // (openExternalUrl has already returned by the time this rejects).
    window.open(url, '_blank', 'noopener,noreferrer')?.focus();
  });
  return true;
}

/**
 * Wires {@link openMacroLinkInApp} into `openExternalUrl`. Called from the Tauri
 * navigation setup; returns the unregister disposer.
 */
export function registerMacroLinkInterceptor(): () => void {
  return registerExternalUrlInterceptor(openMacroLinkInApp);
}
