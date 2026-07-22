import { isTauri } from './platform';

const Hosts = {
  Prod: 'macro.com',
  Dev: 'dev.macro.com',
  Staging: 'staging.macro.com',
  Localhost: 'localhost',
  // The webview's own origin under the http asset scheme (e.g. Windows/Android),
  // where `window.location.hostname` is `tauri.localhost` rather than `localhost`.
  TauriLocalhost: 'tauri.localhost',
} as const;

function cleanHostname(hostname: string): string {
  // Strip only a leading `www.` (parity with the Rust `strip_prefix("www.")`);
  // a bare `replace('www.', '')` would also collapse a mid-string occurrence,
  // e.g. `macro.www.com` -> `macro.com`, letting a foreign host masquerade as
  // a Macro one.
  return hostname.toLowerCase().replace(/^www\./, '');
}

export function isValidMacroAppHostname(hostname: string): boolean {
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
  // On Tauri, window.location.hostname is 'localhost' (custom tauri:// scheme)
  // or 'tauri.localhost' (http asset scheme, e.g. Windows/Android), but Macro
  // links are built with the real web origin (macro.com, dev.macro.com, or
  // staging.macro.com). Accept any recognized Macro host when running inside
  // the native Tauri app (mirrors APP_LINK_HOSTS on the Rust side).
  if (
    isTauri() &&
    (current === Hosts.Localhost || current === Hosts.TauriLocalhost)
  ) {
    return (
      target === Hosts.Prod || target === Hosts.Dev || target === Hosts.Staging
    );
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
  if (!isValidMacroAppHostname(parsed.hostname)) {
    return null;
  }
  return {
    path: pathname.slice('/app'.length) || '/',
    query: parsed.search.slice(1),
  };
}
