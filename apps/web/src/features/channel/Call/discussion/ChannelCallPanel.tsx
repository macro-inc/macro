import { TraceFlow } from '@app/observability/flow';
import { Channel } from '@channel/Channel/Channel';
import {
  ChannelTabProvider,
  useChannelTabOptional,
} from '@channel/Channel/ChannelTabContext';
import { DEFAULT_CHANNEL_TAB } from '@channel/Channel/channel-tabs';
import { type JSX, Show } from 'solid-js';

/** Channels outside a channel surface still need a tab context to read. */
function TabContextBoundary(props: { children: JSX.Element }) {
  return (
    <Show
      when={useChannelTabOptional()}
      fallback={
        <ChannelTabProvider
          activeTab={() => DEFAULT_CHANNEL_TAB}
          setActiveTab={() => undefined}
        >
          {props.children}
        </ChannelTabProvider>
      }
    >
      {props.children}
    </Show>
  );
}

/** The channel, opened on the call's thread, in the call's panel. */
export function ChannelCallPanel(props: {
  channelId: string;
  rootId: string;
  onViewChannel: () => void;
  onOutsideCountChange?: (count: number) => void;
}) {
  return (
    <TabContextBoundary>
      <TraceFlow name="channel.call-panel.view">
        <Channel
          channelId={props.channelId}
          autofocus={false}
          callPanel={{
            rootId: props.rootId,
            onViewChannel: props.onViewChannel,
            onOutsideCountChange: props.onOutsideCountChange,
          }}
        />
      </TraceFlow>
    </TabContextBoundary>
  );
}
