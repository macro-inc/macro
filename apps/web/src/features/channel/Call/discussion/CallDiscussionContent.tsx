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
 * knows there is another kind.
 */
export function CallDiscussionContent(props: {
  discussion: Accessor<CallDiscussion | undefined>;
  panel: CallPanelState;
  onViewChannel: (channelId: string) => void;
  onOutsideCountChange?: (count: number) => void;
  /** The state the channel needs, for a host that doesn't already provide it. */
  channelHost?: (channel: JSX.Element) => JSX.Element;
}) {
  const channelThread = () => {
    const discussion = props.discussion();
    return discussion?.kind === 'channel_thread' ? discussion : undefined;
  };
  const callChat = () => {
    const discussion = props.discussion();
    return discussion?.kind === 'call_chat' ? discussion : undefined;
  };

  return (
    <Suspense>
      <Switch>
        <Match when={channelThread()} keyed>
          {(thread) => {
            const panel = (
              <ChannelCallPanel
                channelId={thread.channel_id}
                rootId={thread.root_id}
                onViewChannel={() => props.onViewChannel(thread.channel_id)}
                onOutsideCountChange={props.onOutsideCountChange}
              />
            );
            return props.channelHost ? props.channelHost(panel) : panel;
          }}
        </Match>
        <Match when={callChat()} keyed>
          {(chat) => (
            <CallChat
              callId={chat.call_id}
              open={props.panel.open}
              focusOnOpen={props.panel.focusOnOpen}
              onClose={props.panel.onClose}
            />
          )}
        </Match>
      </Switch>
    </Suspense>
  );
}
