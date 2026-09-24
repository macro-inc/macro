import { getNativeMobilePlatform } from '@core/util/platform';
import { setPostLoginRedirect } from '@core/util/postLoginRedirect';
import { useNavigate } from '@solidjs/router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createEffect, onCleanup } from 'solid-js';
import { registerMacroLinkInterceptor } from './macroLinkInterceptor';

type NavigateEvent = {
  path: string;
  query: string;
};

/// this must be used as a child of router
export function useTauriNavigationEffect() {
  const navigate = useNavigate();

  createEffect(() => {
    // Send side of the same `navigate` bridge as the listener below: route
    // Macro `/app` links opened via `openExternalUrl` in-app instead of the
    // system browser.
    const unregisterInterceptor = registerMacroLinkInterceptor();
    let unsubscribe: () => void | undefined;

    async function inner() {
      unsubscribe = await listen<NavigateEvent>('navigate', (ev) => {
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
      // On a cold open, the deep-link handler emits `navigate` during
      // startup, before this listener exists, and the event is lost — pull
      // the launch deep link now that we can receive it.
      invoke('flush_launch_deep_link').catch((e) => {
        console.error('failed to flush launch deep link', e);
      });
    }
    inner();

    return onCleanup(() => {
      unregisterInterceptor();
      if (unsubscribe) {
        unsubscribe();
      }
    });
  });
}
