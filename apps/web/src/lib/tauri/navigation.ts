import { handlePipedreamCallback } from '@core/pipedream/connect-callback';
import { fireAndForget } from '@core/util/fireAndForget';
import { getNativeMobilePlatform } from '@core/util/platform';
import { setPostLoginRedirect } from '@core/util/postLoginRedirect';
import { Telemetry } from '@macro-inc/observability';
import { triggerNotificationNavigation } from '@notifications/notification-navigation-intent';
import { useNavigate } from '@solidjs/router';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { createEffect, onCleanup } from 'solid-js';
import { registerMacroLinkInterceptor } from './macroLinkInterceptor';

type NavigateEvent = {
  path: string;
  query: string;
};

async function flushLaunchDeepLink(listening: Promise<UnlistenFn>) {
  // fireAndForget reports a failed listen().
  await listening;
  // On a cold open, the deep-link handler emits `navigate` during startup,
  // before this listener exists, and the event is lost — pull the launch deep
  // link now that we can receive it.
  try {
    await invoke('flush_launch_deep_link');
  } catch (e) {
    console.error('failed to flush launch deep link', e);
  }
}

async function stopListening(listening: Promise<UnlistenFn>) {
  let unlisten: UnlistenFn;
  try {
    unlisten = await listening;
  } catch {
    // A failed listen() was already reported by flushLaunchDeepLink.
    return;
  }
  // UnlistenFn returns the unlisten IPC promise despite its void type.
  return unlisten();
}

/// this must be used as a child of router
export function useTauriNavigationEffect() {
  const navigate = useNavigate();

  createEffect(() => {
    // Send side of the same `navigate` bridge as the listener below: route
    // Macro `/app` links opened via `openExternalUrl` in-app instead of the
    // system browser.
    const unregisterInterceptor = registerMacroLinkInterceptor();

    const unlisten = listen<NavigateEvent>('navigate', (ev) => {
      if (handlePipedreamCallback(ev.payload.path, ev.payload.query)) return;
      if (ev.payload.path === '/notification') {
        const notificationId = new URLSearchParams(ev.payload.query).get(
          'notificationId'
        );
        if (notificationId) {
          const span = Telemetry.span('notification.activate');
          try {
            span.setAttr('notification.id', notificationId);
            span.run(() => triggerNotificationNavigation(notificationId));
          } finally {
            span.end();
          }
        }
        return;
      }
      const path = ev.payload.query
        ? `${ev.payload.path}?${ev.payload.query}`
        : ev.payload.path;
      if (
        getNativeMobilePlatform() === 'android' &&
        ev.payload.path !== '/login'
      ) {
        // Route through the session gate. During cold start the login marker
        // can precede the user-info query and is not proof of authentication.
        if (ev.payload.path === '/') {
          navigate(path);
        } else {
          setPostLoginRedirect(path);
          navigate('/');
        }
      } else {
        navigate(path);
      }
    });
    fireAndForget(flushLaunchDeepLink(unlisten), 'tauri-navigation');

    return onCleanup(() => {
      unregisterInterceptor();
      fireAndForget(stopListening(unlisten), 'tauri-navigation');
    });
  });
}
