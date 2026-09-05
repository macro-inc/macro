import { createSignal } from 'solid-js';

/**
 * An app somebody asked to connect from outside the Connections page (an
 * agent reply's "Connect X" chip). The chip sets it and opens Settings →
 * Connections; the Pipedream section there consumes it and starts the
 * Connect flow. A signal rather than a URL parameter because the settings
 * layout rebuilds its URL from split state and drops query strings.
 */
const [pendingConnectApp, setPendingConnectApp] = createSignal<string>();

/** Ask the Connections page to start connecting `appSlug` once it shows. */
export function requestConnectApp(appSlug: string) {
  setPendingConnectApp(appSlug);
}

/** The app slug waiting to be connected, if any. */
export { pendingConnectApp };

/** Mark the pending request as taken so it runs exactly once. */
export function clearPendingConnectApp() {
  setPendingConnectApp(undefined);
}
