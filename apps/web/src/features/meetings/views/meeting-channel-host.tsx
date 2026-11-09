import { AppProviders } from '@components/app/AppProviders';
import { ItemDndProvider } from '@components/app/ItemDragAndDrop';
import type { JSX } from 'solid-js';

/**
 * A meeting page renders without the app's providers, and a channel call's
 * panel is the channel itself. Mounted only when such a call's panel opens.
 */
export function MeetingChannelHost(props: { children: JSX.Element }) {
  return (
    <AppProviders>
      <ItemDndProvider>{props.children}</ItemDndProvider>
    </AppProviders>
  );
}
