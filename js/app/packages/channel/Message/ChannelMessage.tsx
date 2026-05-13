import { useMessageActionDrawer } from '@channel/Mobile/message-action-drawer-context';
import { longPressHighlight } from '@core/directive/longPressHighlight';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import TrashIcon from '@macro-icons/square/trash.svg';
import { cn } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import type { MessageEditor } from '../Channel/create-message-editor';
import { MessageEditorContent } from '../Channel/InlineMessageEditor';
import type { MessageSelectionState } from './context';
import { MessageSelectionProvider, useMessage } from './context';
import type { ChannelMessageListMeta } from './list-meta';
import { Message } from './Message';
import type { MessageActions, MessageData } from './types';

type ChannelMessageProps = {
  channelId: string;
  message: MessageData;
  actions?: MessageActions;
  listMeta?: ChannelMessageListMeta;
  messageEditor?: MessageEditor;
  highlighted?: boolean;
  selectionState?: MessageSelectionState;
  onClick?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
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

function _GroupedMeta(props: { messageEditor?: MessageEditor }) {
  const message = useMessage();

  return (
    <Show when={!isEditingMessage(props.messageEditor, message().id)}>
      <div
        class={cn(
          'absolute right-4 -top-9 z-10',
          'items-center gap-2 shrink-0 bg-surface p-1',
          'hidden group-hover/message:flex',
          isTouchDevice() && 'hidden'
        )}
      >
        <Message.EditedIndicator />
        <Message.Timestamp compact format="time" />
      </div>
    </Show>
  );
}

function DeletedMessageLayout() {
  return (
    <Message.Layout class="pt-(--regular-message-padding-t) pb-2">
      <Message.Slot placement="icon">
        <div class="shrink-0 size-(--user-icon-width) rounded-full bg-edge-muted text-ink-muted flex items-center justify-center">
          <TrashIcon class="size-5" aria-hidden="true" />
        </div>
      </Message.Slot>
      <Message.Slot placement="content" class="ph-no-capture">
        <p class="text-sm text-ink-muted italic">This message was deleted.</p>
      </Message.Slot>
    </Message.Layout>
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
        {/* On message hover, timestamp floats above actions. */}
        <div class="grow shrink-0 min-w-0 flex justify-end group-hover/message:absolute group-hover/message:right-1 group-hover/message:-top-9 group-hover/message:p-1">
          <Message.Timestamp class="ml-auto shrink-0" format="dateAndTime" />
        </div>
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
      <MessageActionsSlot messageEditor={props.messageEditor} />
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
          />
          {/* TODO (seamus): hiding the grouped meta for now */}
          {/*<GroupedMeta messageEditor={props.messageEditor} />*/}
        </div>
      </Message.Slot>
      <Message.Slot
        placement="footer"
        class="ph-no-capture flex flex-col min-w-0"
      >
        <MessageFooter messageEditor={props.messageEditor} />
      </Message.Slot>
      <MessageActionsSlot messageEditor={props.messageEditor} />
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
      selected={props.selectionState?.isSelected}
      onClick={props.onClick}
      ref={(el) =>
        longPressHighlight(el, () => ({
          onLongPress: () => drawerManager?.open(props.message, props.actions),
        }))
      }
    >
      <MessageSelectionProvider value={props.selectionState}>
        <Switch>
          <Match when={props.message.deleted_at != null}>
            <DeletedMessageLayout />
          </Match>
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
