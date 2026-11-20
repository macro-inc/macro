import { AppProviders } from '@components/app/AppProviders';
import { ItemDndProvider } from '@components/app/ItemDragAndDrop';
import type { JSX } from 'solid-js';

/**
 * A meeting page renders without the app's providers, and a call's discussion
 * renders a channel panel with the app's providers. Mounted only when the
 * panel opens.
 */
export function MeetingDiscussionHost(props: { children: JSX.Element }) {
  return (
    <AppProviders>
      <ItemDndProvider>{props.children}</ItemDndProvider>
    </AppProviders>
  );
}
