export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function acquireFetch() {
  // @ts-ignore: tauri adds this on the window instance
  if (isTauri()) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch;
  }
  return window.fetch;
}

// async function acquireWebsocket() {
//   if (isTauri()) {
//     const ws = await import("@tauri-apps/plugin-websocket");
//     return ws
//   }
//   return WebSocket
// }

// export const connectPlatformWebsocket: ReturnType<typeof WebSocket["conne"]

// wrapper around window.fetch which just forwards args to fetch on the web.
// In tauri environments this forwards requests into the tauri http client
export const platformFetch: typeof window.fetch = (url, opts) => {
  return acquireFetch().then((f) => f(url, opts));
};
