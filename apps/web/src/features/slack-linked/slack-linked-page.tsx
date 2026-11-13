import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { useSlackLinked } from './context/slack-linked-context';
import { createSlackPage, type SlackHandoff } from './primitives/slack-page';
import { MobileSlackPage } from './views/mobile/slack-page';
import { SlackPage } from './views/slack-page';

/**
 * The External tab's Slack page: sign in to workspaces, then add their Slack
 * Connect conversations, grouped by workspace. Holds the page's state and
 * picks the desktop or touch view.
 */
export function SlackLinkedPage(props: { handoff?: SlackHandoff }) {
  const page = createSlackPage(useSlackLinked(), props.handoff);
  return (
    <Show when={isTouchDevice()} fallback={<SlackPage page={page} />}>
      <MobileSlackPage page={page} />
    </Show>
  );
}
