import { Message } from '@channel/Message/Message';
import { ThreadRow } from '@channel/Thread/ThreadRow';
import type { MessageData } from '@core/messages/types';
import type { MetaSendProgress } from '@service-storage/generated/schemas/metaSendProgress';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { DeliveryStatus } from '../components/delivery-status';
import type { MessagingProvider } from '../core/delivery';

export function MessageDelivery(props: {
  send?: MetaSendProgress;
  provider: MessagingProvider;
  userId?: string;
  canRecover: boolean;
  onRecover: (send: MetaSendProgress) => void;
}) {
  return (
    <Show when={props.send}>
      {(send) => (
        <DeliveryStatus
          state={send().state}
          createdAt={send().created_at}
          provider={props.provider}
          error={send().error_code}
          onRecover={
            props.canRecover && send().user_id === props.userId
              ? () => props.onRecover(send())
              : undefined
          }
        />
      )}
    </Show>
  );
}

/** Render durable attempts with Macro's message primitives, without native actions. */
export function ReplyAttempt(props: {
  send: MetaSendProgress;
  provider: MessagingProvider;
  accountName?: string;
  userId?: string;
  canRecover: boolean;
  onRecover: (send: MetaSendProgress) => void;
}) {
  const preview = () =>
    match(props.send.payload.message)
      .with({ type: 'text' }, (message) => message.text)
      .with({ type: 'mutation' }, (message) =>
        message.operation === 'reaction'
          ? 'Updating reaction'
          : message.operation === 'edit'
            ? 'Editing message'
            : 'Deleting message for everyone'
      )
      .with({ type: 'media' }, (message) =>
        message.caption
          ? `${message.caption}\n${message.kind} attachment`
          : `${message.kind} attachment`
      )
      .with(
        { type: 'template' },
        (message) =>
          `WhatsApp template (${message.language})${message.parameters.length ? `\n${message.parameters.join(', ')}` : ''}`
      )
      .exhaustive();
  const message = (): MessageData => ({
    id: `external-send:${props.send.id}`,
    content: '',
    sender_id: props.send.user_id,
    imported_author: props.accountName
      ? { name: props.accountName }
      : undefined,
    created_at: props.send.created_at,
    updated_at: props.send.created_at,
    attachments: [],
    reactions: [],
  });
  return (
    <ThreadRow message={message()} showDividers={false}>
      <Message.Root
        message={message()}
        class="w-full"
        data-external-send-id={props.send.id}
      >
        <Message.Layout class="pt-(--regular-message-padding-t) pb-2">
          <Message.Slot placement="icon">
            <Message.SenderIcon />
          </Message.Slot>
          <Message.Slot
            placement="header"
            class="flex flex-wrap items-baseline gap-1"
          >
            <Message.SenderName />
            <Message.Timestamp format="time" />
          </Message.Slot>
          <Message.Slot placement="content" class="ph-no-capture">
            <p class="text-base text-ink whitespace-pre-wrap wrap-break-word">
              {preview()}
            </p>
          </Message.Slot>
          <Message.Slot placement="footer">
            <MessageDelivery {...props} />
          </Message.Slot>
        </Message.Layout>
      </Message.Root>
    </ThreadRow>
  );
}
