import { Match, Show, Switch } from 'solid-js';
import { cn } from '@ui/utils/classname';
import type { MessageActions, MessageData } from './types';
import { Message } from './Message';
import type { ChannelMessageListMeta } from './list-meta';
import { useMessage, MessageSelectionProvider } from './context';
import type { MessageSelectionState } from './context';
import { useMessageActionDrawer } from '@channel/Mobile/message-action-drawer-context';
import type { MessageEditor } from '../Channel/create-message-editor';
import { MessageEditorContent } from '../Channel/InlineMessageEditor';
import { longPressHighlight } from '@core/directive/longPressHighlight';

type ChannelMessageProps = {
  channelId: string;
  message: MessageData;
  actions?: MessageActions;
  listMeta?: ChannelMessageListMeta;
  messageEditor?: MessageEditor;
  highlighted?: boolean;
  selectionState?: MessageSelectionState;
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
            class={props.class}
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
      <Message.Slot placement="header" class="flex items-center gap-1 min-w-0">
        <Message.SenderName />
        <Message.EditedIndicator />
        <Message.Timestamp class="ml-auto" />
      </Message.Slot>
      <Message.Slot placement="content" class="ph-no-capture">
        <MessageContentSlot
          channelId={props.channelId}
          messageEditor={props.messageEditor}
        />
      </Message.Slot>
      <Message.Slot
        placement="footer"
        class="ph-no-capture flex flex-col min-w-0"
      >
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
  return (
    <Message.Layout>
      <Message.Slot placement="icon">
        <Message.SenderIcon hidden />
      </Message.Slot>
      <Message.Slot placement="content">
        <div class={cn('ph-no-capture flex gap-3 min-w-0 items-start')}>
          <MessageContentSlot
            channelId={props.channelId}
            messageEditor={props.messageEditor}
            class="flex-1 min-w-0"
          />
          <GroupedMeta messageEditor={props.messageEditor} />
        </div>
      </Message.Slot>
      <Message.Slot
        placement="footer"
        class="ph-no-capture flex flex-col min-w-0"
      >
        <MessageFooter messageEditor={props.messageEditor} />
      </Message.Slot>
      <Message.Slot placement="actions">
        <MessageActionsSlot messageEditor={props.messageEditor} />
      </Message.Slot>
    </Message.Layout>
  );
}

export function ChannelMessage(props: ChannelMessageProps) {
  const drawerManager = useMessageActionDrawer();
  const isGrouped = () => props.listMeta?.isGroupedWithPrevious === true;

  return (
    <Message.Root
      message={props.message}
      actions={props.actions}
      highlighted={props.highlighted}
      ref={(el) =>
        longPressHighlight(el, () => ({
          onLongPress: () => drawerManager?.open(props.message, props.actions),
        }))
      }
    >
      <MessageSelectionProvider value={props.selectionState}>
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
      </MessageSelectionProvider>
    </Message.Root>
  );
}
