import { useMessageActionDrawer } from '@channel/Mobile/message-action-drawer-context';
import { touchHandler } from '@core/directive/touchHandler';
import type { IUser } from '@core/user/types';
import TrashIcon from '@icon/square-trash.svg';
import { type Accessor, type JSX, Match, Show, Switch } from 'solid-js';
import type { MessageEditor } from '../Channel/create-message-editor';
import { MessageEditorContent } from '../Channel/InlineMessageEditor';
import { isUnifiedInputMode } from '../unified-input-mode';
import { useMessage } from './context';
import type { ChannelMessageListMeta } from './list-meta';
import { Message } from './Message';
import { MaybeSwipeToReplyRow } from './SwipeToReplyRow';
import type { MessageActions, MessageData } from './types';

type ChannelMessageProps = {
  channelId: string;
  message: MessageData;
  actions?: MessageActions;
  listMeta?: ChannelMessageListMeta;
  messageEditor?: MessageEditor;
  participants?: Accessor<IUser[]>;
  selected?: boolean;
  /**
   * The unified-input mode's floating reply/edit input, or message
   * navigation, points at this message.
   */
  targeted?: boolean;
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
  participants?: Accessor<IUser[]>;
  class?: string;
}) {
  const message = useMessage();
  const isEditing = () => isEditingMessage(props.messageEditor, message().id);

  return (
    <Switch>
      <Match when={isEditing() && !isUnifiedInputMode() && props.messageEditor}>
        {(messageEditor) => (
          <MessageEditorContent
            channelId={props.channelId}
            message={message()}
            messageEditor={messageEditor()}
            participants={props.participants}
            class={props.class}
          />
        )}
      </Match>
      <Match when={message().content.trim() !== ''}>
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

function MessageActionsSlot(props: {
  messageEditor?: MessageEditor;
  showTimestamp?: boolean;
}) {
  const message = useMessage();

  return (
    <Show when={!isEditingMessage(props.messageEditor, message().id)}>
      <Message.ActionMenu showTimestamp={props.showTimestamp} />
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
      <Message.Slot
        placement="content"
        class="ph-no-capture flex min-h-(--user-icon-width) items-center"
      >
        <p class="text-sm text-ink-muted italic">This message was deleted.</p>
      </Message.Slot>
    </Message.Layout>
  );
}

function RegularMessageLayout(props: {
  channelId: string;
  messageEditor?: MessageEditor;
  participants?: Accessor<IUser[]>;
}) {
  return (
    <Message.Layout class="pt-(--regular-message-padding-t)">
      <Message.Slot placement="icon">
        <Message.SenderIcon />
      </Message.Slot>
      <Message.Slot placement="header" class="flex flex-col gap-0.5 min-w-0">
        <div class="flex items-baseline gap-1 min-w-0">
          <Message.SenderName />
          <Message.AgentBadge />
          <Message.Timestamp class="shrink-0" format="time" />
          <Message.EditedIndicator class="shrink-0" />
        </div>
        <Message.FromPill />
      </Message.Slot>
      <Message.Slot placement="content" class="ph-no-capture">
        <MessageContentSlot
          channelId={props.channelId}
          messageEditor={props.messageEditor}
          participants={props.participants}
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
  participants?: Accessor<IUser[]>;
}) {
  return (
    <Message.Layout>
      {/* No icon placeholder: the grid template already reserves the gutter
          column, and an invisible 36px icon would stretch the row, leaving
          more space below the text than above it. */}
      <Message.Slot placement="content">
        <div class="ph-no-capture flex gap-3 min-w-0 items-start">
          <MessageContentSlot
            channelId={props.channelId}
            messageEditor={props.messageEditor}
            participants={props.participants}
            class="min-w-0 flex-1"
          />
        </div>
      </Message.Slot>
      <Message.Slot
        placement="footer"
        class="ph-no-capture flex flex-col min-w-0"
      >
        <MessageFooter messageEditor={props.messageEditor} />
      </Message.Slot>
      {/* Grouped rows have no header timestamp; the hover toolbar carries it. */}
      <MessageActionsSlot messageEditor={props.messageEditor} showTimestamp />
    </Message.Layout>
  );
}

export function ChannelMessage(props: ChannelMessageProps) {
  const drawerManager = useMessageActionDrawer();
  const isGrouped = () => props.listMeta?.isGroupedWithPrevious === true;

  return (
    <MaybeSwipeToReplyRow message={props.message} actions={props.actions}>
      <Message.Root
        class="w-full"
        message={props.message}
        actions={props.actions}
        selected={props.selected}
        targeted={
          props.targeted ||
          // In unified-input mode the edit happens in the floating input; the
          // accent bar marks the message it is bound to.
          (isUnifiedInputMode() &&
            isEditingMessage(props.messageEditor, props.message.id))
        }
        onClick={props.onClick}
        ref={(el) =>
          touchHandler(el, () => ({
            touchClassName: 'channel-message-long-press-highlight',
            // Yield to the native image callout when long-pressing an image.
            skipSelectors: ['img'],
            onLongPress: () =>
              drawerManager?.open(props.message, props.actions),
          }))
        }
      >
        <Switch>
          <Match when={props.message.deleted_at != null}>
            <DeletedMessageLayout />
          </Match>
          <Match when={isGrouped()}>
            <GroupedMessageLayout
              channelId={props.channelId}
              messageEditor={props.messageEditor}
              participants={props.participants}
            />
          </Match>
          <Match when={true}>
            <RegularMessageLayout
              channelId={props.channelId}
              messageEditor={props.messageEditor}
              participants={props.participants}
            />
          </Match>
        </Switch>
      </Message.Root>
    </MaybeSwipeToReplyRow>
  );
}
