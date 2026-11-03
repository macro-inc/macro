import { convertFileSrc } from '@tauri-apps/api/core';
import { NATIVE_SESSION_SERVICE_URLS } from '../constant/servers';
import { isTauri } from './platform';

const nativeServices = NATIVE_SESSION_SERVICE_URLS.map((url) => new URL(url));
let originalFetch: typeof fetch | undefined;

/** Called by the entry point before installing the desktop global override. */
export function initializePlatformFetch(
  webviewFetch: typeof fetch
): typeof fetch {
  originalFetch = webviewFetch;
  return createPlatformFetch(webviewFetch);
}

/** Explicit browser transport for APIs that require the webview's origin. */
export const webviewFetch: typeof fetch = (input, init) =>
  (originalFetch ?? globalThis.fetch)(input, init);

/** Native HTTP owns the desktop session cookie jar and bypasses remote CORS. */
export function createPlatformFetch(
  webviewFetch: typeof window.fetch
): typeof window.fetch {
  // Tauri sends invoke calls through global fetch. Preserve its webview-owned
  // endpoint or native HTTP recursively invokes itself and expands each payload.
  const ipc = isTauri() ? new URL(convertFileSrc('', 'ipc')) : undefined;
  return async (input, init) => {
    if (!isTauri()) return webviewFetch(input, init);
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      document.baseURI
    );
    // Service URLs own authentication even when a development proxy happens to
    // share the page origin or use loopback. Webview and reqwest jars differ.
    const service = nativeServices.some(
      (base) =>
        url.origin === base.origin &&
        (url.pathname === base.pathname ||
          url.pathname.startsWith(`${base.pathname.replace(/\/$/, '')}/`))
    );
    // Assets share the webview origin; authenticated service prefixes take
    // precedence even when the development proxy shares that origin.
    if (
      (ipc && url.protocol === ipc.protocol && url.host === ipc.host) ||
      (!service && url.origin === new URL(document.baseURI).origin) ||
      url.protocol === 'data:' ||
      url.protocol === 'blob:'
    ) {
      return webviewFetch(input, init);
    }
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch(input, init);
  };
}

// Native startup installs the transport explicitly; all callers share it.
export const platformFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, init);
