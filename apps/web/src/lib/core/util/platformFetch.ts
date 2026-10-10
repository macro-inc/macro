import { isTauri } from './platform';

// Capture before index.tsx installs platformFetch as the global fetch.
const webviewFetch = window.fetch.bind(window);

/** Use native HTTP for remote requests in Tauri and webview fetch for assets. */
export const platformFetch: typeof window.fetch = async (...args) => {
  if (!isTauri()) return window.fetch(...args);

  const input = args[0];
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    document.baseURI
  );
  const useWebview =
    !['http:', 'https:'].includes(url.protocol) ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';
  if (useWebview) return webviewFetch(...args);

  const { fetch } = await import('@tauri-apps/plugin-http');
  return fetch(...args);
};
