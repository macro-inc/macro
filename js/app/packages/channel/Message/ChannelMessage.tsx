import { Match, Show, Switch } from 'solid-js';
import type { MessageActions, MessageData } from './types';
import { Message } from './Message';
import type { ChannelMessageListMeta } from './list-meta';
import { useMessage } from './context';
import type { MessageEditor } from '../Channel/create-message-editor';
import { MessageEditorContent } from '../Channel/InlineMessageEditor';

type ChannelMessageProps = {
  channelId: string;
  message: MessageData;
  actions?: MessageActions;
  listMeta?: ChannelMessageListMeta;
  messageEditor?: MessageEditor;
};

function isEditingMessage(
  messageEditor: MessageEditor | undefined,
  messageId: string
) {
  return messageEditor?.state()?.messageId === messageId;
}

function MessageContentSlot(props: {
  channelId: string;
  messageEditor?: MessageEditor;
  class?: string;
}) {
  const message = useMessage();
  const isEditing = () => isEditingMessage(props.messageEditor, message().id);

  return (
    <Switch>
      <Match when={isEditing() && props.messageEditor}>
        {(messageEditor) => (
          <MessageEditorContent
            channelId={props.channelId}
            messageEditor={messageEditor()}
          />
        )}
      </Match>
      <Match when={true}>
        <Message.Content class={props.class} />
      </Match>
    </Switch>
  );
}

function MessageFooter(props: { messageEditor?: MessageEditor }) {
  const message = useMessage();

  return (
    <Show when={!isEditingMessage(props.messageEditor, message().id)}>
      <Message.Attachments />
      <Message.Reactions />
    </Show>
  );
}

function MessageActionsSlot(props: { messageEditor?: MessageEditor }) {
  const message = useMessage();

  return (
    <Show when={!isEditingMessage(props.messageEditor, message().id)}>
      <Message.ActionMenu />
    </Show>
  );
}

function GroupedMeta(props: { messageEditor?: MessageEditor }) {
  const message = useMessage();

  return (
    <Show when={!isEditingMessage(props.messageEditor, message().id)}>
      <div class="flex items-center gap-2 shrink-0">
        <Message.EditedIndicator />
        <Message.Timestamp compact />
      </div>
    </Show>
  );
}

function RegularMessageLayout(props: {
  channelId: string;
  messageEditor?: MessageEditor;
}) {
  return (
    <Message.Layout class="pt-(--regular-message-padding-t)">
      <Message.Slot placement="icon">
        <Message.SenderIcon />
      </Message.Slot>
      <Message.Slot placement="header" class="flex items-center gap-2 min-w-0">
        <Message.SenderName />
        <Message.EditedIndicator />
        <Message.Timestamp class="ml-auto" />
      </Message.Slot>
      <Message.Slot placement="content" class="mt-0.5">
        <MessageContentSlot
          channelId={props.channelId}
          messageEditor={props.messageEditor}
        />
      </Message.Slot>
      <Message.Slot placement="footer" class="flex flex-col min-w-0">
        <MessageFooter messageEditor={props.messageEditor} />
      </Message.Slot>
      <Message.Slot placement="actions">
        <MessageActionsSlot messageEditor={props.messageEditor} />
      </Message.Slot>
    </Message.Layout>
  );
}

function GroupedMessageLayout(props: {
  channelId: string;
  messageEditor?: MessageEditor;
}) {
  const message = useMessage();
  const isEditing = () => isEditingMessage(props.messageEditor, message().id);

  return (
    <Message.Layout>
      <Message.Slot placement="icon">
        <Message.SenderIcon hidden />
      </Message.Slot>
      <Message.Slot placement="content">
        <div
          class="flex gap-3 min-w-0"
          classList={{
            'items-center': !isEditing(),
            'items-start': isEditing(),
          }}
        >
          <MessageContentSlot
            channelId={props.channelId}
            messageEditor={props.messageEditor}
            class="flex-1 min-w-0"
          />
          <GroupedMeta messageEditor={props.messageEditor} />
        </div>
      </Message.Slot>
      <Message.Slot placement="footer" class="flex flex-col min-w-0">
        <MessageFooter messageEditor={props.messageEditor} />
      </Message.Slot>
      <Message.Slot placement="actions">
        <MessageActionsSlot messageEditor={props.messageEditor} />
      </Message.Slot>
    </Message.Layout>
  );
}

export function ChannelMessage(props: ChannelMessageProps) {
  const isGrouped = () => props.listMeta?.isGroupedWithPrevious === true;

  return (
    <Message.Root message={props.message} actions={props.actions}>
      <Switch>
        <Match when={isGrouped()}>
          <GroupedMessageLayout
            channelId={props.channelId}
            messageEditor={props.messageEditor}
          />
        </Match>
        <Match when={true}>
          <RegularMessageLayout
            channelId={props.channelId}
            messageEditor={props.messageEditor}
          />
        </Match>
      </Switch>
    </Message.Root>
  );
}
