import type { MessageActions, MessageData } from './types';
import { Message } from './Message';

type ChannelMessageProps = {
  message: MessageData;
  actions?: MessageActions;
};

export function ChannelMessage(props: ChannelMessageProps) {
  return (
    <Message.Root message={props.message} actions={props.actions}>
      <Message.Layout>
        <Message.Slot placement="icon">
          <Message.SenderIcon />
        </Message.Slot>
        <Message.Slot placement="header" class="flex items-center gap-2">
          <Message.SenderName />
          <Message.EditedIndicator />
          <Message.Timestamp class="ml-auto" />
        </Message.Slot>
        <Message.Slot placement="body" class="flex flex-col min-w-0">
          <Message.Content />
          <Message.Attachments />
          <Message.Reactions />
        </Message.Slot>
        <Message.Slot placement="actions">
          <Message.ActionMenu />
        </Message.Slot>
      </Message.Layout>
    </Message.Root>
  );
}
