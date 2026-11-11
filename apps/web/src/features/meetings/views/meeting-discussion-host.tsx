import { AppProviders } from '@components/app/AppProviders';
import { ItemDndProvider } from '@components/app/ItemDragAndDrop';
import type { JSX } from 'solid-js';

/**
 * A meeting page renders without the app's providers, and a call's discussion
 * renders the app's messages: a channel call's panel is the channel itself,
 * and a call's own chat is a message thread. Mounted only when the panel opens.
 */
export function MeetingDiscussionHost(props: { children: JSX.Element }) {
  return (
    <AppProviders>
      <ItemDndProvider>{props.children}</ItemDndProvider>
    </AppProviders>
  );
}
