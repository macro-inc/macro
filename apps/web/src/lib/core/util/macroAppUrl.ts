import { emit } from '@tauri-apps/api/event';
import { isTauri } from './platform';

const Hosts = {
  Prod: 'macro.com',
  Dev: 'dev.macro.com',
  Localhost: 'localhost',
} as const;

function cleanHostname(hostname: string): string {
  return hostname.replace('www.', '').toLowerCase();
}

export function isValidMentionHostname(hostname: string): boolean {
  const current = cleanHostname(window.location.hostname);
  const target = cleanHostname(hostname);
  if (current === target) {
    return true;
  }
  if (
    (target === Hosts.Dev && current === Hosts.Localhost) ||
    (target === Hosts.Localhost && current === Hosts.Dev)
  ) {
    return true;
  }
  // On Tauri, window.location.hostname is 'localhost', but Macro links are
  // built with the real web origin (macro.com or dev.macro.com). Accept any
  // recognized Macro host when running inside the native Tauri app.
  if (isTauri() && current === Hosts.Localhost) {
    return target === Hosts.Prod || target === Hosts.Dev;
  }
  return false;
}

type InternalAppLink = {
  path: string;
  query: string;
};

/**
 * Parses an absolute URL pointing at the Macro web app (e.g.
 * `https://macro.com/app/channel/<id>?message=<id>`) into a router path and
 * query. Returns null for anything that is not a Macro `/app` URL.
 *
 * The `/app` prefix is stripped because the Tauri router uses `/` as its
 * base (mirrors `MacroScheme::from_url` on the Rust side).
 */
export function parseInternalAppLink(url: string): InternalAppLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const pathname = parsed.pathname;
  if (pathname !== '/app' && !pathname.startsWith('/app/')) {
    return null;
  }
  if (!isValidMentionHostname(parsed.hostname)) {
    return null;
  }
  return {
    path: pathname.slice('/app'.length) || '/',
    query: parsed.search.slice(1),
  };
}

/**
 * When running inside the native Tauri app, routes a Macro `/app` link
 * in-app via the same `navigate` event the deep-link handler emits —
 * `window.open` bypasses the webview's navigation hook and would open the
 * link in the system browser.
 *
 * Don't call this directly from UI code — use `openExternalUrl` from
 * `@core/util/url`, which composes this with the `window.open` fallback.
 */
export function maybeOpenInApp(url: string): boolean {
  if (!isTauri()) return false;
  const parsed = parseInternalAppLink(url);
  if (!parsed) return false;
  console.info('[nav-debug] macro link intercepted', {
    url,
    path: parsed.path,
    query: parsed.query,
  });
  emit('navigate', parsed).catch((e) => {
    console.error('[nav-debug] failed to emit navigate event', e);
  });
  return true;
}
