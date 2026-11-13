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

export type CallDiscussionAccess =
  | { kind: 'member' }
  | {
      kind: 'guest';
      session: { token: string; participantId: string };
    };

/**
 * The one place a call chooses its discussion. Nothing below it
 * knows there is another kind. The record polls and returns a new object each
 * time, so these stay unkeyed: remounting would lose scroll and focus.
 */
export function CallDiscussionContent(props: {
  discussion: Accessor<CallDiscussion | undefined>;
  access: CallDiscussionAccess;
  panel: CallPanelState;
  onViewChannel: (channelId: string) => void;
  onOutsideCountChange?: (count: number) => void;
  /**
   * The app state a channel needs when its host does not provide it. The host
   * renders the channel itself so it can see those providers.
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

  return (
    <Suspense>
      <Switch>
        <Match when={props.access.kind === 'member' && channelThread()}>
          {(thread) => {
            const panel = () => (
              <ChannelCallPanel
                channelId={thread().channel_id}
                rootId={thread().root_id}
                onViewChannel={() => props.onViewChannel(thread().channel_id)}
                onOutsideCountChange={props.onOutsideCountChange}
              />
            );
            return props.host ? props.host(panel) : panel();
          }}
        </Match>
        <Match when={callChat()}>
          {(chat) => (
            <CallChat
              callId={chat().call_id}
              access={props.access}
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
