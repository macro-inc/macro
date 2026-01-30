import { useBlockId } from '@core/block';
import { useChannelName } from '@core/context/channels';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { type JSXElement, Suspense } from 'solid-js';
import { Channel } from './Channel';
import { URL_PARAMS } from '@block-channel/constants';
import type { TargetMessageInfo } from '@block-channel/component/MessageList/MessageList';
import { ChannelContextProvider } from '@block-channel/hooks/channel';

export function WithTopBar(props: { children: JSXElement }) {
  return <div>{props.children}</div>;
}

export type JoinState = 'REQUIRED' | 'NOT_REQUIRED';

type IncomingParams = Record<string, string>;

export type BlockChannelProps = IncomingParams & {};

export default function BlockChannel(props: BlockChannelProps) {
  const channelId = useBlockId();
  const channelName = useChannelName(channelId);

  const targetMessage = () => {
    const messageID = props[URL_PARAMS.message];
    if (!messageID) return;
    const threadID = props[URL_PARAMS.thread];

    return {
      messageId: messageID,
      threadId: threadID,
    } satisfies TargetMessageInfo;
  };

  return (
    <Suspense>
      <DocumentBlockContainer title={channelName() ?? 'Channel'}>
        <ChannelContextProvider channelId={() => channelId}>
          <Channel channelId={channelId} target={targetMessage()} />
        </ChannelContextProvider>
      </DocumentBlockContainer>
    </Suspense>
  );
}
