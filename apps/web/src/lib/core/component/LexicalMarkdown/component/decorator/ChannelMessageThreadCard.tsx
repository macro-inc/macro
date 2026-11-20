import { ReadonlyThread } from '@channel/StandaloneThread';
import { openThreadMessage } from '@channel/StandaloneThread/open-thread-message';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';

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
        openThreadMessage(
          orchestrator,
          {
            channelId: props.channelId,
            threadMessageId: props.messageId,
            messageId: clickedMessageId,
          },
          'channel-message-thread-card'
        );
      }}
    />
  );
}
