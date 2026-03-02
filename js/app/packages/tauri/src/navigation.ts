import { useNavigate } from '@solidjs/router';
import { listen } from '@tauri-apps/api/event';
import { createEffect, onCleanup } from 'solid-js';

type NavigateEvent = {
  path: string;
  query: string;
  notificationId?: string;
};

let registeredNavigate: ((path: string) => void) | null = null;
let pendingNavigation: string | null = null;

/**
 * Register a navigate function to be called from outside the router context.
 * Called by useTauriNavigationEffect when the router is ready.
 * Drains any navigation that was buffered before the router was ready.
 */
export function registerNavigate(fn: (path: string) => void) {
  registeredNavigate = fn;
  if (pendingNavigation) {
    const path = pendingNavigation;
    pendingNavigation = null;
    fn(path);
  }
}

/**
 * Trigger navigation from outside the router context.
 * Used by PushNotification to navigate when a notification is tapped.
 * If the router is not yet ready, buffers the path for replay on mount.
 */
export function triggerNavigation(path: string) {
  if (registeredNavigate) {
    registeredNavigate(path);
  } else {
    console.warn(
      `[navigation] triggerNavigation: router not ready, buffering path ${path}`
    );
    pendingNavigation = path;
  }
}

/// this must be used as a child of router
export function useTauriNavigationEffect() {
  const navigate = useNavigate();

  registerNavigate(navigate);

  createEffect(() => {
    let unsubscribe: () => void | undefined;

    async function inner() {
      unsubscribe = await listen<NavigateEvent>('navigate', (ev) => {
        console.info({ ev });
        if (ev.payload.notificationId) {
          navigate(
            `/component/notification?notificationId=${ev.payload.notificationId}`
          );
        } else {
          if (ev.payload.query) {
            navigate(`${ev.payload.path}?${ev.payload.query}`);
          } else {
            navigate(ev.payload.path);
          }
        }
      });
    }
    inner();

    return onCleanup(() => {
      if (unsubscribe) {
        unsubscribe();
      }
    });
  });
}
