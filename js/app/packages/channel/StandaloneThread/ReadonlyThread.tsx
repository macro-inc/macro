import type { ApiChannelMessage } from '@service-comms/client';
import { Root } from './Root';
import { ParentMessage } from './ParentMessage';
import { Replies } from './Replies';

type ReadonlyThreadProps = {
  channelId: string;
  messageId: string;
  data?: ApiChannelMessage;
  onClickMessage?: (messageId: string, e: MouseEvent) => void;
};

export function ReadonlyThread(props: ReadonlyThreadProps) {
  return (
    <Root
      channelId={props.channelId}
      messageId={props.messageId}
      data={props.data}
    >
      <ParentMessage
        onClickMessage={props.onClickMessage}
        class={
          props.onClickMessage ? 'cursor-pointer hover:bg-hover' : undefined
        }
      />
      <Replies
        onClickMessage={props.onClickMessage}
        class={
          props.onClickMessage ? 'cursor-pointer hover:bg-hover' : undefined
        }
      />
    </Root>
  );
}
