import { useNavigate } from '@solidjs/router';
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
    }
    inner();

    return onCleanup(() => {
      if (unsubscribe) {
        unsubscribe();
      }
    });
  });
}
