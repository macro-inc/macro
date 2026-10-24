import { DateDivider } from '@channel/Message/DateDivider';
import { Layout } from '@channel/Message/Layout';
import { NewDivider } from '@channel/Message/NewDivider';
import { Root } from '@channel/Message/Root';
import { Slot } from '@channel/Message/Slot';
import type { MessageData } from '@core/messages/types';
import { Avatar, Button, Dropdown } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import { DeliveryStatus } from '../../whatsapp-linked/components/delivery-status';
import { InboundAttachmentPlaceholder } from '../../whatsapp-linked/components/inbound-attachment';
import { groupInitials } from '../../whatsapp-linked/core/group';
import type { GroupMessage } from '../core/group';

export function GroupMessageRow(props: {
  message: GroupMessage;
  index: number;
  previousSentAt?: string;
  firstUnread: boolean;
  reply?: GroupMessage;
  canSend: boolean;
  busy: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReact: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  onRead: () => void;
  onOpenReply: (messageId: string) => void;
  renderAttachment: (documentId: string) => JSX.Element;
}) {
  const messageData = (): MessageData => ({
    id: props.message.id,
    content: props.message.body,
    sender_id: props.message.sender.userId ?? '',
    imported_author: { name: props.message.sender.name },
    created_at: props.message.sentAt,
    updated_at: props.message.sentAt,
    attachments: [],
    reactions: [],
  });
  const meta = () => ({
    index: props.index,
    previousTopLevelCreatedAt: props.previousSentAt,
    isFirstNewMessage: props.firstUnread,
    isNewMessage: props.firstUnread,
  });
  return (
    <>
      <DateDivider createdAt={props.message.sentAt} listMeta={meta()} />
      <NewDivider
        createdAt={props.message.sentAt}
        listMeta={meta()}
        onDismiss={props.onRead}
      />
      <Root
        message={messageData()}
        class="py-3"
        actions={{
          onReply: props.onReply,
          onEdit: props.canEdit ? props.onEdit : undefined,
          onDelete: props.canDelete ? props.onDelete : undefined,
        }}
      >
        <Layout>
          <Slot placement="icon">
            <Avatar size="md">
              <Avatar.Fallback>
                {groupInitials(props.message.sender.name)}
              </Avatar.Fallback>
            </Avatar>
          </Slot>
          <Slot
            placement="header"
            class="flex flex-wrap items-baseline gap-x-2 text-sm"
          >
            <span class="font-medium">{props.message.sender.name}</span>
            <time
              class="text-xs text-ink-muted"
              dateTime={props.message.sentAt}
            >
              {new Intl.DateTimeFormat(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              }).format(new Date(props.message.sentAt))}
            </time>
            <Show when={props.message.edited}>
              <span class="text-xs text-ink-muted">edited</span>
            </Show>
          </Slot>
          <Slot placement="content" class="ph-no-capture">
            <Show when={!props.message.deleted && props.message.replyTo}>
              {(id) => (
                <button
                  type="button"
                  class="mb-2 block max-w-full truncate border-l-2 border-accent py-1 pl-3 text-left text-xs text-ink-muted"
                  onClick={() => props.onOpenReply(id())}
                >
                  {props.reply
                    ? `${props.reply.sender.name}: ${props.reply.deleted ? 'Deleted message' : props.reply.body || 'Attachment'}`
                    : 'View quoted message'}
                </button>
              )}
            </Show>
            <p class="whitespace-pre-wrap break-words text-sm leading-6">
              {props.message.deleted
                ? 'This message was deleted.'
                : props.message.body}
            </p>
            <Show when={!props.message.deleted}>
              <div class="flex flex-wrap gap-2">
                <For each={props.message.attachments}>
                  {(attachment) => (
                    <Show
                      when={
                        attachment.state === 'ready' && attachment.documentId
                      }
                      fallback={
                        <InboundAttachmentPlaceholder attachment={attachment} />
                      }
                    >
                      {(id) => props.renderAttachment(id())}
                    </Show>
                  )}
                </For>
              </div>
            </Show>
          </Slot>
          <Slot placement="footer">
            <Show when={!props.message.deleted}>
              <div class="mt-1 flex flex-wrap items-center gap-1">
                <For each={props.message.reactions}>
                  {(reaction) => (
                    <Button
                      variant={reaction.mine ? 'outline' : 'ghost'}
                      size="sm"
                      aria-label={`${reaction.emoji} ${reaction.count}${reaction.mine ? ', your reaction' : ''}`}
                      disabled={!props.canReact || props.busy}
                      onClick={() =>
                        props.onReact(reaction.mine ? '' : reaction.emoji)
                      }
                    >
                      {reaction.emoji} {reaction.count}
                    </Button>
                  )}
                </For>
                <Show when={props.canSend}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={props.busy}
                    onClick={props.onReply}
                  >
                    Reply
                  </Button>
                  <Show when={props.canReact}>
                    <Dropdown>
                      <Dropdown.Trigger
                        variant="ghost"
                        size="sm"
                        aria-label="React to message"
                        disabled={props.busy}
                      >
                        React
                      </Dropdown.Trigger>
                      <Dropdown.Content>
                        <For each={['👍', '❤️', '😂', '🎉', '🙏', '👀']}>
                          {(emoji) => (
                            <Dropdown.Item
                              onSelect={() => props.onReact(emoji)}
                            >
                              {emoji}
                            </Dropdown.Item>
                          )}
                        </For>
                      </Dropdown.Content>
                    </Dropdown>
                  </Show>
                  <Show when={props.canEdit}>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={props.busy}
                      onClick={props.onEdit}
                    >
                      Edit
                    </Button>
                  </Show>
                  <Show when={props.canDelete}>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={props.busy}
                      onClick={props.onDelete}
                    >
                      Delete
                    </Button>
                  </Show>
                </Show>
              </div>
              <Show when={props.message.delivery}>
                {(state) => <DeliveryStatus state={state()} />}
              </Show>
            </Show>
          </Slot>
        </Layout>
      </Root>
    </>
  );
}
