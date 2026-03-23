import { useBlockId } from '@core/block';
import { useChannelName } from '@core/context/channels';
import { EntityPermissionsGate } from '@core/component/EntityPermissionsGate';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { useBlockEntityCommands } from '@app/component/next-soup/actions';
import { type JSXElement, onMount, Suspense } from 'solid-js';
import { URL_PARAMS } from '@block-channel/constants';
import type { TargetMessageInfo } from '@block-channel/component/MessageList/MessageList';
import { useChannelQuery } from '@queries/channel/channel';
import { ChannelContextProvider } from '@block-channel/hooks/channel';
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
  useBlockEntityCommands();
  const channelId = useBlockId();

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
