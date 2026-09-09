/**
 * Chat's half of a deferred `SendEmail`: the composer over the pending call,
 * finished through the cognition tool endpoints.
 *
 * Edits are persisted as they settle (`updateToolCall`, then a `userEdited`
 * response so the card keeps rendering as a composer); Send runs the call
 * (`callTool`) and writes the sent outcome back into the chat's message.
 */

import type { EmailRecipient } from '@block-email/component/EmailContext';
import { useChatContext } from '@core/component/AI/context';
import type { AssistantMessagePart } from '@core/component/AI/types';
import { toast } from '@core/component/Toast/Toast';
import { useChatQuery } from '@queries/chat';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { SendEmail } from '@service-cognition/generated/tools/types';
import type { JSX } from 'solid-js';
import type { UserToolReviewSink } from '../user-tool-review';
import { EmailDraftComposer } from './DraftComposer';

type ComposeToolProps = {
  chatId: string;
  messageId: string;
  toolCallId: string;
  initialData: SendEmail;
  recipientOptions?: EmailRecipient[];
  header?: JSX.Element;
  readOnly?: boolean;
  streamLocked?: boolean;
};

type SendEmailSnapshot = {
  bcc: Array<{ email: string; name: string | null }>;
  cc: Array<{ email: string; name: string | null }>;
  includeSignature: boolean | null;
  replyingToId: string | null;
  subject: string;
  to: Array<{ email: string; name: string | null }>;
};

function createSendEmailSnapshot(data: SendEmail): SendEmailSnapshot {
  return {
    to: (data.to ?? []).map((item) => ({
      email: item.email,
      name: item.name ?? null,
    })),
    cc: (data.cc ?? []).map((item) => ({
      email: item.email,
      name: item.name ?? null,
    })),
    bcc: (data.bcc ?? []).map((item) => ({
      email: item.email,
      name: item.name ?? null,
    })),
    subject: data.subject ?? '',
    replyingToId: data.replyingToId ?? null,
    includeSignature: data.includeSignature ?? null,
  };
}

function sameSendEmailSnapshot(
  left: SendEmailSnapshot,
  right: SendEmailSnapshot
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getSentToolResponse(result: unknown): {
  message_id: string;
  thread_id: string;
} | null {
  if (typeof result !== 'object' || result === null) return null;

  if (
    'UserAction' in result &&
    typeof result.UserAction === 'object' &&
    result.UserAction !== null &&
    'sent' in result.UserAction &&
    typeof result.UserAction.sent === 'object' &&
    result.UserAction.sent !== null &&
    'message_id' in result.UserAction.sent &&
    'thread_id' in result.UserAction.sent &&
    typeof result.UserAction.sent.message_id === 'string' &&
    typeof result.UserAction.sent.thread_id === 'string'
  ) {
    return {
      message_id: result.UserAction.sent.message_id,
      thread_id: result.UserAction.sent.thread_id,
    };
  }

  return null;
}

function toSentResponse(messageId: string, threadId: string) {
  return {
    UserAction: {
      sent: {
        message_id: messageId,
        thread_id: threadId,
      },
    },
  } as const;
}

function updateToolParts(
  parts: AssistantMessagePart[],
  args: SendEmail,
  response: unknown,
  toolCallId: string
) {
  let changed = false;

  const nextParts = parts.map((part) => {
    if (part.type === 'toolCall' && part.id === toolCallId) {
      changed = true;
      return { ...part, json: args };
    }

    if (part.type === 'toolCallResponseJson' && part.id === toolCallId) {
      changed = true;
      return { ...part, json: response };
    }

    return part;
  });

  return changed ? nextParts : parts;
}

export function ComposeTool(props: ComposeToolProps) {
  const chat = useChatContext();
  const chatQuery = useChatQuery(() => props.chatId);
  const isOwner = () => chatQuery.data?.userAccessLevel === 'owner';
  const ownerKnown = () => chatQuery.isSuccess;
  const canAct = () =>
    ownerKnown() &&
    isOwner() &&
    props.readOnly !== true &&
    props.streamLocked !== true;
  const lockedNotice = () => {
    if (props.readOnly) return undefined;
    if (ownerKnown() && !isOwner()) {
      return 'Only the chat owner can send or edit this email.';
    }
    return undefined;
  };

  let lastPersistedSnapshot = createSendEmailSnapshot(props.initialData);
  let finalized = false;

  async function persistEdit(args: SendEmail) {
    if (finalized) return;
    const nextSnapshot = createSendEmailSnapshot(args);
    if (sameSendEmailSnapshot(nextSnapshot, lastPersistedSnapshot)) return;

    const updateCallResult =
      await cognitionApiServiceClient.updateToolCall<'SendEmail'>({
        chat_id: props.chatId,
        messageId: props.messageId,
        toolCallId: props.toolCallId,
        args,
      });
    if (updateCallResult.isErr()) {
      toast.failure('Failed to save changes');
      return;
    }

    const updateResponseResult =
      await cognitionApiServiceClient.updateToolResponse<'SendEmail'>({
        chat_id: props.chatId,
        messageId: props.messageId,
        toolCallId: props.toolCallId,
        response: { UserAction: 'userEdited' },
      });
    if (updateResponseResult.isErr()) {
      toast.failure('Failed to save changes');
      return;
    }

    lastPersistedSnapshot = nextSnapshot;
  }

  const sink: UserToolReviewSink<SendEmail> = {
    canAct,
    lockedNotice,
    onEdit: (args) => void persistEdit(args),
    onExecute: async (args) => {
      const result = await cognitionApiServiceClient.callTool<'SendEmail'>({
        chat_id: props.chatId,
        messageId: props.messageId,
        toolCallId: props.toolCallId,
        args,
      });
      if (result.isErr()) {
        toast.failure('Failed to send email');
        return false;
      }
      const sentResponse = getSentToolResponse(result.value);
      if (sentResponse) {
        finalized = true;
        chat.setMessages((messages) =>
          messages.map((message) => {
            if (
              message.id !== props.messageId ||
              !Array.isArray(message.content)
            ) {
              return message;
            }
            const content = updateToolParts(
              message.content,
              args,
              toSentResponse(sentResponse.message_id, sentResponse.thread_id),
              props.toolCallId
            );
            if (content === message.content) return message;
            return { ...message, content };
          })
        );
      }
      toast.success('Email sent');
      return sentResponse !== null;
    },
    // Chat's email card has no reject control; the composer never calls this.
    onReject: async () => false,
  };

  return (
    <EmailDraftComposer
      initialData={props.initialData}
      sink={sink}
      recipientOptions={props.recipientOptions}
      header={props.header}
      readOnly={props.readOnly}
      debugName={`${props.chatId}:${props.messageId}:${props.toolCallId}`}
    />
  );
}
