import {
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { useUserId } from '@core/context/user';
import { Show } from 'solid-js';
import { newHomeContent } from './new-home-navigation';
import { readNewHomeTab } from './new-home-preferences';
import { useNewHomeMode } from './use-new-home-mode';

/**
 * `/new-home`, where New Home's rail item and `g h` go: the tab the viewer
 * last had open, or old Home while New Home is off.
 */
export const NewHomeRouteView = withAuth(() => {
  const mode = useNewHomeMode();
  const userId = useUserId();
  const destination = () => {
    if (mode() === 'off') return { type: 'component' as const, id: 'home' };
    const id = userId();
    return newHomeContent(id ? readNewHomeTab(id) : 'recent');
  };
  return (
    <Show when={mode() !== undefined}>
      <RedirectSplit to={destination()} />
    </Show>
  );
});
