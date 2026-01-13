import { useNavigate } from '@solidjs/router';
import { listen } from '@tauri-apps/api/event';
import { createEffect, onCleanup } from 'solid-js';

type NavigateEvent = {
  path: string;
  query: string;
  notificationId?: string;
};

let registeredNavigate: ((path: string) => void) | null = null;

/**
 * Register a navigate function to be called from outside the router context.
 * Called by useTauriNavigationEffect when the router is ready.
 */
export function registerNavigate(fn: (path: string) => void) {
  registeredNavigate = fn;
}

/**
 * Trigger navigation from outside the router context.
 * Used by PushNotification to navigate when a notification is tapped.
 */
export function triggerNavigation(path: string) {
  if (registeredNavigate) {
    registeredNavigate(path);
  } else {
    console.warn('Navigation triggered before navigate was registered');
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
