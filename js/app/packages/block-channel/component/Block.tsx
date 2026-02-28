import { useBlockId } from '@core/block';
import { useChannelName } from '@core/context/channels';
import { EntityPermissionsGate } from '@core/component/EntityPermissionsGate';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { type JSXElement, onMount, Suspense } from 'solid-js';
import { Channel as NewChannel } from '@channel/Channel/Channel';
import { URL_PARAMS } from '@block-channel/constants';
import type { TargetMessageInfo } from '@block-channel/component/MessageList/MessageList';
import { useChannelQuery } from '@queries/channel/channel';
import { ChannelContextProvider } from '@block-channel/hooks/channel';
import { ENABLE_NEW_CHANNELS } from '@core/constant/featureFlags';
import { Channel } from './Channel';

export function WithTopBar(props: { children: JSXElement }) {
  return <div>{props.children}</div>;
}
function ChannelBlockSuspenseFallback() {
  onMount(() => {
    console.warn('[block-channel] Top-level BlockChannel suspense triggered');
  });
  return null;
}

export type JoinState = 'REQUIRED' | 'NOT_REQUIRED';

type IncomingParams = Record<string, string>;

export type BlockChannelProps = IncomingParams & {};

export default function BlockChannel(props: BlockChannelProps) {
  const channelId = useBlockId();

  if (ENABLE_NEW_CHANNELS) {
    return (
      <NewChannel
        channelId={channelId}
        // targetMessageId="019c2444-b1c4-7a91-a57d-14bd684388c9"
      />
    );
  }

  const targetMessage = () => {
    const messageID = props[URL_PARAMS.message];
    if (!messageID) return;
    const threadID = props[URL_PARAMS.thread];

    return {
      messageId: messageID,
      threadId: threadID,
    } satisfies TargetMessageInfo;
  };
  const channelName = useChannelName(channelId);
  const channelQuery = useChannelQuery(() => channelId);

  return (
    <EntityPermissionsGate entityType="channel" entityId={channelId}>
      <Suspense fallback={<ChannelBlockSuspenseFallback />}>
        <DocumentBlockContainer title={channelName() ?? 'Channel'}>
          <ChannelContextProvider query={channelQuery}>
            <Channel channelId={channelId} target={targetMessage()} />
          </ChannelContextProvider>
        </DocumentBlockContainer>
      </Suspense>
    </EntityPermissionsGate>
  );
}
