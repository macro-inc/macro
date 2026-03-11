import type { MessageActions, MessageData } from './types';
import { Message } from './Message';
import type { ChannelMessageListMeta } from './list-meta';
import { Show } from 'solid-js';

type ChannelMessageProps = {
  message: MessageData;
  actions?: MessageActions;
  listMeta?: ChannelMessageListMeta;
};

function MessageFooter() {
  return (
    <>
      <Message.Attachments />
      <Message.Reactions />
    </>
  );
}

function NormalLayout() {
  return (
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
          <MessageFooter />
        </div>
      </div>
      <Message.ActionMenu />
    </Message.Layout>
  );
}

function GroupedLayout() {
  return (
    <Message.Layout class="py-1">
      <div class="flex items-start gap-2">
        <Message.SenderIcon hidden />
        <div class="flex flex-col flex-1 min-w-0">
          <div class="flex items-center gap-3 min-w-0">
            <Message.Content class="flex-1 min-w-0" />
            <div class="flex items-center gap-2 shrink-0">
              <Message.EditedIndicator />
              <Message.Timestamp compact />
            </div>
          </div>
          <MessageFooter />
        </div>
      </div>
      <Message.ActionMenu />
    </Message.Layout>
  );
}

export function ChannelMessage(props: ChannelMessageProps) {
  const isGrouped = () => props.listMeta?.isGroupedWithPrevious === true;

  return (
    <Message.Root message={props.message} actions={props.actions}>
      <Show when={isGrouped()} fallback={<NormalLayout />}>
        <GroupedLayout />
      </Show>
    </Message.Root>
  );
}
