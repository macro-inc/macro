import type { UnlistenFn } from '@tauri-apps/api/event';

/**
 * Removes a listener once its `listen()` call resolves; a listener that
 * failed to register resolves to `undefined` and has nothing to remove. Start
 * it with `fireAndForget` in teardown (FE-56): it rejects when `listen()`
 * failed or the native side already dropped the listener.
 */
export async function unlistenWhenReady(
  listening: Promise<UnlistenFn | undefined>
): Promise<void> {
  const unlisten = await listening;
  // UnlistenFn returns the unlisten IPC promise despite its void type.
  return unlisten?.();
}
