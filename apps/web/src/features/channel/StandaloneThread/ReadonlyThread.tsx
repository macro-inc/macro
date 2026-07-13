import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import { StandaloneThread } from './StandaloneThread';

type ReadonlyThreadProps = {
  channelId: string;
  messageId: string;
  data?: ApiChannelMessage;
  onClickMessage?: (messageId: string, e: MouseEvent) => void;
};

export function ReadonlyThread(props: ReadonlyThreadProps) {
  return (
    <StandaloneThread.Root
      channelId={props.channelId}
      messageId={props.messageId}
      data={props.data}
    >
      <StandaloneThread.ParentMessage
        onClickMessage={props.onClickMessage}
        class={props.onClickMessage ? 'hover:bg-hover' : undefined}
      />
      <StandaloneThread.Replies
        onClickMessage={props.onClickMessage}
        class={props.onClickMessage ? 'hover:bg-hover' : undefined}
      />
    </StandaloneThread.Root>
  );
}
