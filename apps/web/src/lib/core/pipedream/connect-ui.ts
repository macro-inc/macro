/**
 * Minimal client for Pipedream's hosted Connect UI.
 *
 * Vendored equivalent of the iframe portion of `@pipedream/sdk`'s browser
 * client (adding the dependency would require regenerating the nix
 * node_modules hash): a fullscreen iframe pointed at Pipedream's hosted
 * connect page, which reports lifecycle events back via `postMessage`.
 */

const CONNECT_UI_URL = 'https://pipedream.com/_static/connect.html';

export type PipedreamConnectEvent =
  /** The user authorized the app; `accountId` is the connected account. */
  | { type: 'success'; accountId: string }
  /** Something failed inside the connect flow. */
  | { type: 'error'; error?: string }
  /** The user closed the Connect UI. */
  | { type: 'close' };

export type PipedreamConnectUI = {
  /** Remove the iframe and stop listening for events. */
  close: () => void;
};

/**
 * Open Pipedream's hosted Connect UI in a fullscreen iframe.
 *
 * The UI walks the user through authorizing `app` (OAuth consent or API-key
 * entry — Pipedream owns the whole flow and stores the credentials).
 * Lifecycle events are delivered to `onEvent`; the caller closes the UI
 * after a success event (the hosted page closes itself otherwise).
 */
export function openPipedreamConnectUI(options: {
  /** Short-lived Connect token minted by our backend for this user. */
  token: string;
  /** The Pipedream app to connect, by name slug (e.g. `linear`). */
  app: string;
  onEvent: (event: PipedreamConnectEvent) => void;
}): PipedreamConnectUI {
  const params = new URLSearchParams({
    token: options.token,
    app: options.app,
  });

  const iframe = document.createElement('iframe');
  iframe.title = 'Pipedream Connect';
  iframe.src = `${CONNECT_UI_URL}?${params.toString()}`;
  iframe.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;border:0;display:block;overflow:hidden auto;width:100%;height:100%';

  const cleanup = () => {
    window.removeEventListener('message', onMessage);
    iframe.remove();
  };

  const onMessage = (event: MessageEvent) => {
    // The hosted page posts from pipedream.com; ignore everything else.
    if (!String(event.origin).endsWith('pipedream.com')) return;
    const data = event.data as
      | { type?: string; authProvisionId?: string; error?: string }
      | undefined;
    switch (data?.type) {
      case 'success':
        if (data.authProvisionId) {
          options.onEvent({ type: 'success', accountId: data.authProvisionId });
        }
        break;
      case 'error':
        options.onEvent({ type: 'error', error: data.error });
        break;
      case 'close':
        cleanup();
        options.onEvent({ type: 'close' });
        break;
      default:
        break;
    }
  };

  window.addEventListener('message', onMessage);
  document.body.appendChild(iframe);

  return { close: cleanup };
}
