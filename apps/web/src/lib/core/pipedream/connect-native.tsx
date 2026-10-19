import { fireAndForget } from '@core/util/fireAndForget';
import { getWebOrigin } from '@core/util/webOrigin';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { ResultAsync } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { registerPipedreamCallback } from './connect-callback';
import type { openPipedreamConnectUI, PipedreamConnectUI } from './connect-ui';

/** Run consent in a browser: native popup interception breaks iframe OAuth. */
export function openNativePipedreamConnectUI(
  options: Parameters<typeof openPipedreamConnectUI>[0]
): PipedreamConnectUI {
  const host = document.createElement('div');
  (options.container ?? document.body).appendChild(host);
  const callback = registerPipedreamCallback((event) => {
    close();
    options.onEvent(event);
  });
  const url = new URL('/app/pipedream-connect.html', getWebOrigin());
  // Fragments never reach the host's access logs or Referer headers.
  url.hash = new URLSearchParams({
    token: options.token,
    app: options.app,
    state: callback.state,
  }).toString();
  const cancel = () => {
    close();
    options.onEvent({ type: 'close' });
  };
  const timer = setTimeout(cancel, 10 * 60 * 1000);
  let closed = false;
  const [openFailed, setOpenFailed] = createSignal(false);
  const launch = async () => {
    // This hosted /app page must bypass Macro's ordinary in-app link routing.
    const result = await ResultAsync.fromPromise(
      invoke('plugin:opener|open_url', { url: url.href }),
      () => undefined
    );
    if (!closed) setOpenFailed(result.isErr());
  };
  const dispose = render(
    () => (
      <Dialog open onOpenChange={(open) => !open && cancel()}>
        <div class="flex flex-col gap-4 p-6 bg-panel text-ink rounded-lg">
          <Dialog.Title>Finish connecting in your browser</Dialog.Title>
          <Dialog.Description>
            Authorize the connection, then choose Return to Macro. If you closed
            the browser tab, cancel and try again.
          </Dialog.Description>
          <Show when={openFailed()}>
            <p role="alert">
              Could not open your browser. Try again or cancel.
            </p>
          </Show>
          <div class="flex gap-2">
            <Button
              variant="outline"
              onClick={() => fireAndForget(launch(), 'pipedream-connect-open')}
            >
              Open browser again
            </Button>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      </Dialog>
    ),
    host
  );
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    callback.remove();
    dispose();
    host.remove();
  }
  fireAndForget(launch(), 'pipedream-connect-open');
  return { close };
}
