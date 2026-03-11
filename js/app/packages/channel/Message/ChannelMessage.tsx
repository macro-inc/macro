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
        <div class="flex items-start gap-2">
          <Message.SenderIcon />
          <div class="flex flex-col flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <Message.SenderName />
              <Message.EditedIndicator />
              <Message.Timestamp class="ml-auto" />
            </div>
            <Message.Content />
            <Message.Attachments />
            <Message.Reactions />
          </div>
        </div>
        <Message.ActionMenu />
      </Message.Layout>
    </Message.Root>
  );
}
