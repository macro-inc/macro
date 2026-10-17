import type { UnlistenFn } from '@tauri-apps/api/event';

/**
 * Removes a Tauri event listener, ignoring failure. `UnlistenFn` is typed to
 * return void but returns the `plugin:event|unlisten` IPC promise, which
 * rejects when the listener is already gone; dropping it is an unhandled
 * rejection. Accepts the pending result of `listen()` so teardown can run
 * before registration settles, or after it failed.
 */
export function unlistenQuietly(
  unlisten: UnlistenFn | PromiseLike<UnlistenFn | undefined> | undefined
): void {
  Promise.resolve(unlisten)
    .then((fn) => fn?.())
    .catch(() => {});
}
