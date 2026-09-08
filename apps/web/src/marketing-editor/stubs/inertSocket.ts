/**
 * A websocket that is never opened.
 *
 * The demo has no backend, but the editor's import graph reaches two modules
 * that each build a self-connecting websocket singleton at module scope. Those
 * modules are redirected here by the demo's Vite config; this file supplies the
 * shape their consumers use, with every method inert.
 *
 * Why not just let them connect and fail? Because failure is not quiet. Both
 * sockets are built with 20 retries and a heartbeat, and one of them refreshes
 * an auth token on the way up. A CSP-blocked or DNS-failed refresh surfaces as a
 * network error rather than a 401, so the client never records the service as
 * unavailable and retries for as long as the page is open. On the marketing
 * origin those requests are same-site, so every visitor who scrolls to the demo
 * would quietly hammer production auth.
 *
 * The member list is not defensive — it is exactly what consumers reference
 * (`grep -o 'ws\.[a-zA-Z_]*'` over the importers). If the editor later reaches
 * for a member that is not here, it fails with a plain "not a function" naming
 * the member, which is the signal to add it.
 */

/** Swallows a send. Returns void, like the real `send`. */
function noop(): void {}

export type InertSocket = {
  send: () => void;
  reconnectIfDisconnected: () => void;
  addEventListener: () => void;
  removeEventListener: () => void;
  /** Real code reads this to check readyState; absent means "no socket". */
  underlyingWebsocket: undefined;
};

export function createInertSocket(): InertSocket {
  return {
    send: noop,
    reconnectIfDisconnected: noop,
    addEventListener: noop,
    removeEventListener: noop,
    underlyingWebsocket: undefined,
  };
}
