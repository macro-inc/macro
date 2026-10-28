import { PIPEDREAM_CALLBACK_PATH } from './connect-callback';
import { openPipedreamConnectUI } from './connect-ui';

/** Standalone browser handoff; no Macro browser login is needed. */
export function mountPipedreamBrowserConnect(root: HTMLElement) {
  const params = new URLSearchParams(window.location.hash.slice(1));
  history.replaceState(null, '', window.location.pathname);
  const token = params.get('token');
  const app = params.get('app');
  const state = params.get('state');
  if (!token || !app || !state) {
    root.textContent =
      'This connection link has expired. Start again in Macro.';
    return;
  }
  root.textContent = 'Connect your account to continue.';
  const ui = openPipedreamConnectUI({
    token,
    app,
    onEvent: (event) => {
      // Pipedream displays recoverable errors inside its own UI.
      if (event.type === 'error') return;
      ui.close();
      const callback = new URL(`macro://${PIPEDREAM_CALLBACK_PATH}`);
      callback.searchParams.set('state', state);
      callback.searchParams.set(
        'outcome',
        event.type === 'success' ? 'success' : 'closed'
      );
      if (event.type === 'success')
        callback.searchParams.set('account_id', event.accountId);
      root.textContent =
        event.type === 'success'
          ? 'Authorization finished. Return to Macro to save your connection.'
          : 'Connection canceled. Return to Macro to continue.';
      const link = document.createElement('a');
      link.href = callback.href;
      link.textContent = 'Return to Macro';
      root.appendChild(link);
    },
  });
}
