import {
  ComposeLayout,
  EmailComposeToolbar,
} from '@block-email/component/compose';
import {
  type ComposeContextValue,
  ComposeProvider,
  type ComposeValidationError,
} from '@block-email/component/compose/ComposeContext';
import type { DraftFormAttachment } from '@block-email/component/createEmailFormState';
import type { EmailRecipient } from '@block-email/component/EmailContext';
import { convertContactInfoToEmailRecipient } from '@block-email/util/recipientConversion';
import { useChatContext } from '@core/component/AI/context';
import type { AssistantMessagePart } from '@core/component/AI/types';
import { toast } from '@core/component/Toast/Toast';
import { isErr } from '@core/util/maybeResult';
import { useChatQuery } from '@queries/chat';
import { useEmailLinksQuery } from '@queries/email/link';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { SendEmail } from '@service-cognition/generated/tools/types';
import { debounce } from '@solid-primitives/scheduled';
import type { LexicalEditor } from 'lexical';
import { createSignal, type JSX, Show } from 'solid-js';

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
  body: string;
  cc: Array<{ email: string; name: string | null }>;
  replyingToId: string | null;
  subject: string;
  to: Array<{ email: string; name: string | null }>;
};

function toEmailRecipients(
  items: Array<{ email: string; name: string | null }>
): EmailRecipient[] {
  return items.map(convertContactInfoToEmailRecipient);
}

function fromEmailRecipients(
  items: EmailRecipient[]
): Array<{ email: string; name: string | null }> {
  return items.map((recipient) => {
    const email = 'email' in recipient.data ? recipient.data.email : '';
    const name =
      'name' in recipient.data ? (recipient.data.name ?? null) : null;
    return { email, name };
  });
}

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
    body: data.body ?? '',
    replyingToId: data.replyingToId ?? null,
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
  const ownerGateDisabled = () => !chatQuery.isSuccess || !isOwner();
  const showOwnerDisabledMessage = () =>
    chatQuery.isSuccess && !isOwner() && props.readOnly !== true;
  const uiDisabled = () =>
    ownerGateDisabled() ||
    props.readOnly === true ||
    props.streamLocked === true;
  const emailLinksQuery = useEmailLinksQuery();
  const fromAddress = () => {
    const links = emailLinksQuery.data?.links;
    return links && links.length > 0 ? links[0].email_address : undefined;
  };

  const [recipients, setRecipients] = createSignal({
    to: toEmailRecipients(props.initialData.to ?? []),
    cc: toEmailRecipients(props.initialData.cc ?? []),
    bcc: toEmailRecipients(props.initialData.bcc ?? []),
  });
  const [subject, setSubject] = createSignal(props.initialData.subject ?? '');
  const [body, setBody] = createSignal(props.initialData.body ?? '');
  const [isSending, setIsSending] = createSignal(false);
  const [editor, setEditor] = createSignal<LexicalEditor>();
  const [validationErrors, setValidationErrors] = createSignal<
    ComposeValidationError[]
  >([]);
  let toolFinalized = false;
  let lastPersistedSnapshot = createSendEmailSnapshot(props.initialData);

  function collectArgs(): SendEmail {
    return {
      to: fromEmailRecipients(recipients().to),
      cc: fromEmailRecipients(recipients().cc),
      bcc: fromEmailRecipients(recipients().bcc),
      subject: subject(),
      body: body(),
      replyingToId: props.initialData.replyingToId,
    };
  }

  function validate(): boolean {
    const errors: ComposeValidationError[] = [];

    if (recipients().to.length === 0) {
      errors.push({
        type: 'no_recipient',
        message: 'Add at least one recipient',
      });
    }

    if (!body().trim()) {
      errors.push({ type: 'no_message', message: 'Write a message' });
    }

    setValidationErrors(errors);
    return errors.length === 0;
  }

  const debouncedUpdate = debounce(flushUpdate, 150);

  function scheduleUpdate() {
    if (toolFinalized) return;
    debouncedUpdate();
  }

  async function flushUpdate() {
    if (toolFinalized) return;

    const args = collectArgs();
    const nextSnapshot = createSendEmailSnapshot(args);

    if (sameSendEmailSnapshot(nextSnapshot, lastPersistedSnapshot)) {
      return;
    }

    const updateCallResult =
      await cognitionApiServiceClient.updateToolCall<'SendEmail'>({
        chat_id: props.chatId,
        messageId: props.messageId,
        toolCallId: props.toolCallId,
        args,
      });

    if (isErr(updateCallResult)) {
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

    if (isErr(updateResponseResult)) {
      toast.failure('Failed to save changes');
      return;
    }

    lastPersistedSnapshot = nextSnapshot;
  }

  async function handleSend() {
    if (ownerGateDisabled()) return;
    if (!validate()) return;

    setIsSending(true);
    const args = collectArgs();

    const result = await cognitionApiServiceClient.callTool<'SendEmail'>({
      chat_id: props.chatId,
      messageId: props.messageId,
      toolCallId: props.toolCallId,
      args,
    });

    setIsSending(false);

    if (isErr(result)) {
      toast.failure('Failed to send email');
      return;
    }

    const sentResponse = getSentToolResponse(result[1]);
    if (sentResponse) {
      toolFinalized = true;
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
  }

  const ctx: ComposeContextValue = {
    subject,
    attachments: () => [],
    sendTime: () => undefined,
    initialHtml: () => undefined,
    initialMarkdown: () => props.initialData.body,
    setRecipients: (field, value) => {
      setRecipients((prev) => ({ ...prev, [field]: value }));
      scheduleUpdate();
    },
    setSubject: (value) => {
      setSubject(value);
      scheduleUpdate();
    },
    onContentChange: (content) => {
      setBody(content);
      scheduleUpdate();
    },
    onAddAttachments: (_: DraftFormAttachment[]) => {},
    onRemoveAttachment: (_: DraftFormAttachment) => {},
    captureEditor: setEditor,
    onSend: handleSend,
    disabled: () =>
      isSending() ||
      ownerGateDisabled() ||
      props.readOnly === true ||
      props.streamLocked === true,
    isSending,
    isSavingDraft: () => false,
    hasDraft: () => false,
    hasPaidAccess: () => true,
    focusRecipientsOnMount: false,
    includeSelf: true,
    hideAttachments: true,
    recipientOptions: () => [
      ...recipients().to,
      ...recipients().cc,
      ...recipients().bcc,
      ...(props.recipientOptions ?? []),
    ],
    validationError: (type) => validationErrors().find((e) => e.type === type),
    fromAddress,
    recipients,
  };

  return (
    <ComposeProvider value={ctx}>
      <div class="relative">
        <ComposeLayout
          bodyDebugName={`chat-compose:${props.chatId}:${props.messageId}:${props.toolCallId}`}
          class={`flex flex-col w-full text-sm border border-edge-muted rounded-lg p-4 bg-input ${
            uiDisabled()
              ? '[&_button:disabled]:opacity-50 [&_button:disabled]:text-ink-disabled [&_input:disabled]:text-ink-muted'
              : ''
          }`}
          header={
            showOwnerDisabledMessage() ? (
              <div class="text-xs text-ink-extra-muted/60">
                Only the chat owner can send or edit this email.
              </div>
            ) : (
              props.header
            )
          }
          toolbar={
            props.readOnly === true ? undefined : (
              <EmailComposeToolbar editor={editor} />
            )
          }
        />
        <Show when={uiDisabled()}>
          <div aria-hidden="true" class="absolute inset-0 z-10 rounded-lg" />
        </Show>
      </div>
    </ComposeProvider>
  );
}
