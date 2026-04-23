import { ReadonlyThread } from '@channel/StandaloneThread';
import { navigateToChannelMessage } from '@block-channel/utils/link';
import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';

type ChannelMessageThreadCardProps = {
  channelId: string;
  messageId: string;
};

export function ChannelMessageThreadCard(props: ChannelMessageThreadCardProps) {
  const orchestrator = useGlobalBlockOrchestrator();

  return (
    <ReadonlyThread
      channelId={props.channelId}
      messageId={props.messageId}
      onClickMessage={(clickedMessageId, e) => {
        e.stopPropagation();
        const isReply = clickedMessageId !== props.messageId;
        navigateToChannelMessage(
          orchestrator,
          props.channelId,
          clickedMessageId,
          isReply ? props.messageId : undefined
        );
      }}
    />
  );
}
