import { lazyNamed } from '@core/util/lazyNamed';
import {
  type Accessor,
  type JSX,
  lazy,
  Match,
  Suspense,
  Switch,
} from 'solid-js';
import type { CallDiscussion } from './call-discussion';

const CallChat = lazy(() => import('../chat/CallChat'));
const ChannelCallPanel = lazyNamed(
  () => import('./ChannelCallPanel'),
  'ChannelCallPanel'
);

export type CallPanelState = {
  open: boolean;
  focusOnOpen: boolean;
  onClose: () => void;
};

/**
 * The one place a signed-in call chooses its discussion. Nothing below it
 * knows there is another kind. The record polls and returns a new object each
 * time, so these stay unkeyed: remounting would lose scroll and focus.
 */
export function CallDiscussionContent(props: {
  discussion: Accessor<CallDiscussion | undefined>;
  panel: CallPanelState;
  onViewChannel: (channelId: string) => void;
  onOutsideCountChange?: (count: number) => void;
  /**
   * The app state a discussion needs, for a host that doesn't already provide
   * it. Messages need it as much as the channel does. The host renders the
   * discussion itself: one created out here would not see its providers.
   */
  host?: (discussion: () => JSX.Element) => JSX.Element;
}) {
  const channelThread = () => {
    const discussion = props.discussion();
    return discussion?.kind === 'channel_thread' ? discussion : undefined;
  };
  const callChat = () => {
    const discussion = props.discussion();
    return discussion?.kind === 'call_chat' ? discussion : undefined;
  };

  const hosted = (discussion: () => JSX.Element) =>
    props.host ? props.host(discussion) : discussion();

  return (
    <Suspense>
      <Switch>
        <Match when={channelThread()}>
          {(thread) =>
            hosted(() => (
              <ChannelCallPanel
                channelId={thread().channel_id}
                rootId={thread().root_id}
                onViewChannel={() => props.onViewChannel(thread().channel_id)}
                onOutsideCountChange={props.onOutsideCountChange}
              />
            ))
          }
        </Match>
        <Match when={callChat()}>
          {(chat) =>
            hosted(() => (
              <CallChat
                callId={chat().call_id}
                open={props.panel.open}
                focusOnOpen={props.panel.focusOnOpen}
                onClose={props.panel.onClose}
              />
            ))
          }
        </Match>
      </Switch>
    </Suspense>
  );
}
