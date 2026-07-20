import { useNavigate } from '@solidjs/router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createEffect, onCleanup } from 'solid-js';

type NavigateEvent = {
  path: string;
  query: string;
};

/// this must be used as a child of router
export function useTauriNavigationEffect() {
  const navigate = useNavigate();

  createEffect(() => {
    let unsubscribe: () => void | undefined;

    async function inner() {
      unsubscribe = await listen<NavigateEvent>('navigate', (ev) => {
        console.info({ ev });
        const path = ev.payload.query
          ? `${ev.payload.path}?${ev.payload.query}`
          : ev.payload.path;
        navigate(path);
      });
      // On a cold open, the deep-link handler emits `navigate` during
      // startup, before this listener exists, and the event is lost — pull
      // the launch deep link now that we can receive it.
      invoke('flush_launch_deep_link').catch((e) => {
        console.error('[nav-debug] failed to flush launch deep link', e);
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
