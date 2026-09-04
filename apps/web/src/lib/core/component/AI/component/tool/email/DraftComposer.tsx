/**
 * The email composer for a drafted `SendEmail` call, with no opinion about
 * where the draft came from or where the decision goes.
 *
 * Chat mounts it over a pending user tool and sends through the cognition
 * endpoints; an agent session mounts it over a review elicitation and answers
 * the agent. Both hand in a {@link UserToolReviewSink}; the composer only
 * knows how to edit the draft and what Send means.
 */

import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ComposeLayout,
  EmailComposeToolbar,
} from '@block-email/component/compose';
import {
  type ComposeContextValue,
  ComposeProvider,
  type ComposeValidationError,
} from '@block-email/component/compose/ComposeContext';
import { SignaturePreview } from '@block-email/component/compose/SignaturePreview';
import type { DraftFormAttachment } from '@block-email/component/createEmailFormState';
import type { EmailRecipient } from '@block-email/component/EmailContext';
import { decodeBase64Utf8 } from '@block-email/util/decodeBase64';
import { prepareEmailBody } from '@block-email/util/prepareEmailBody';
import { convertContactInfoToEmailRecipient } from '@block-email/util/recipientConversion';
import { enableEmailSignatures } from '@core/constant/featureFlags';
import { useEmailLinksQuery, useEmailSignature } from '@queries/email/link';
import type { SendEmail } from '@service-cognition/generated/tools/types';
import { debounce } from '@solid-primitives/scheduled';
import { cn } from '@ui';
import type { LexicalEditor } from 'lexical';
import { createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import type { UserToolReviewSink } from '../user-tool-review';

export type EmailDraftComposerProps = {
  /** The draft as the agent wrote it, or as the user last saved it. */
  initialData: SendEmail;
  /** Where edits, the send and the rejection go. */
  sink: UserToolReviewSink<SendEmail>;
  /** Extra recipients to offer in the pickers. */
  recipientOptions?: EmailRecipient[];
  /** Shown above the form; the sink's locked notice takes precedence. */
  header?: JSX.Element;
  /** A finished email, shown as it was sent: no toolbar, nothing editable. */
  readOnly?: boolean;
  /** Suffix for the body editor's debug name, unique per draft. */
  debugName: string;
};

function toEmailRecipients(
  items: Array<{ email: string; name?: string | null }>
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

export function EmailDraftComposer(props: EmailDraftComposerProps) {
  const uiDisabled = () => !props.sink.canAct() || props.readOnly === true;
  const emailLinksQuery = useEmailLinksQuery();
  // The inbox this card sends from — always the first linked inbox (shown as
  // "from"); the backend resolves the same default at send time.
  const sendingLink = createMemo(() => emailLinksQuery.data?.links?.[0]);
  const fromAddress = () => sendingLink()?.email_address;
  const signature = useEmailSignature(() => sendingLink()?.id);
  const emailSignaturesFlag = useFeatureFlag(enableEmailSignatures);
  // Whether this email includes the signature. Defaults on; the preview's ✕
  // drops it for this one message. Mirrors the normal composer.
  // Initialize from the persisted tool args so a dismiss survives re-render /
  // reload; only an explicit false counts as dismissed.
  const [includeSignature, setIncludeSignature] = createSignal(
    props.initialData.includeSignature !== false
  );
  const isReplyOrForward = () => Boolean(props.initialData.replyingToId);
  // Signature to preview (and inject on send): a new compose always shows it; a
  // reply/forward only when the inbox's "add to replies & forwards" setting is
  // on. Hidden once dismissed and in the read-only (sent) state. Shown while
  // locked too — the overlay blocks interaction until the lock lifts.
  const previewSignatureHtml = (): string | undefined => {
    if (!emailSignaturesFlag().enabled) return undefined;
    if (props.readOnly) return undefined;
    if (!includeSignature()) return undefined;
    const sig = signature();
    if (!sig) return undefined;
    if (isReplyOrForward()) {
      return sendingLink()?.settings.signature_on_replies_forwards
        ? sig
        : undefined;
    }
    return sig;
  };

  const [recipients, setRecipients] = createSignal({
    to: toEmailRecipients(
      (props.initialData.to ?? []).map((r) => ({ ...r, name: r.name ?? null }))
    ),
    cc: toEmailRecipients(
      (props.initialData.cc ?? []).map((r) => ({ ...r, name: r.name ?? null }))
    ),
    bcc: toEmailRecipients(
      (props.initialData.bcc ?? []).map((r) => ({
        ...r,
        name: r.name ?? null,
      }))
    ),
  });
  const [subject, setSubject] = createSignal(props.initialData.subject ?? '');
  const [isSending, setIsSending] = createSignal(false);
  const [editor, setEditor] = createSignal<LexicalEditor>();
  const [validationErrors, setValidationErrors] = createSignal<
    ComposeValidationError[]
  >([]);
  let finalized = false;

  function collectArgs(): SendEmail {
    return {
      to: fromEmailRecipients(recipients().to),
      cc: fromEmailRecipients(recipients().cc),
      bcc: fromEmailRecipients(recipients().bcc),
      subject: subject(),
      body: prepareEmailBody(editor())?.bodyHtml ?? '',
      replyingToId: props.initialData.replyingToId,
      // Omit to use the backend default policy; false only when dismissed.
      includeSignature: includeSignature() ? undefined : false,
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

    if (!prepareEmailBody(editor())?.bodyText.trim()) {
      errors.push({ type: 'no_message', message: 'Write a message' });
    }

    setValidationErrors(errors);
    return errors.length === 0;
  }

  // Reading the body out of the editor is not free, so edits reach the sink
  // settled, not per keystroke.
  const debouncedEdit = debounce(() => {
    if (finalized || uiDisabled()) return;
    props.sink.onEdit?.(collectArgs());
  }, 150);
  function scheduleUpdate() {
    if (finalized || !props.sink.onEdit) return;
    debouncedEdit();
  }
  onCleanup(() => {
    debouncedEdit.clear();
    props.sink.onDispose?.();
  });

  async function handleSend() {
    if (finalized || uiDisabled() || isSending()) return;
    if (!validate()) return;
    debouncedEdit.clear();
    setIsSending(true);
    const done = await props.sink.onExecute(collectArgs());
    setIsSending(false);
    if (done) finalized = true;
  }

  // `body` is markdown while the AI is drafting, but every persist path
  // replaces it with the base64url-encoded HTML that the SendEmail tool
  // contract requires at send time. Decode and route to the editor slot that
  // matches what the field actually holds.
  const initialBody = (): { html?: string; markdown?: string } => {
    const body = props.initialData.body;
    if (!body) return {};
    const decoded = decodeBase64Utf8(body);
    if (decoded.startsWith('<body')) return { html: decoded };
    return { markdown: body };
  };

  const ctx: ComposeContextValue = {
    subject,
    attachments: () => [],
    sendTime: () => undefined,
    initialHtml: () => initialBody().html,
    initialMarkdown: () => initialBody().markdown,
    setRecipients: (field, value) => {
      setRecipients((prev) => ({ ...prev, [field]: value }));
      scheduleUpdate();
    },
    setSubject: (value) => {
      setSubject(value);
      scheduleUpdate();
    },
    onContentChange: () => {
      scheduleUpdate();
    },
    onAddAttachments: (_: DraftFormAttachment[]) => {},
    onRemoveAttachment: (_: DraftFormAttachment) => {},
    captureEditor: setEditor,
    onSend: handleSend,
    disabled: () => isSending() || uiDisabled(),
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
    // Read-only preview of the signature the backend appends on send, with a ✕
    // to drop it for this one email (persisted through the sink's edit).
    signaturePreview: () => (
      <Show when={previewSignatureHtml()}>
        {(html) => (
          <SignaturePreview
            html={html()}
            onDismiss={() => {
              setIncludeSignature(false);
              scheduleUpdate();
            }}
          />
        )}
      </Show>
    ),
  };

  const header = () => {
    const notice = props.readOnly ? undefined : props.sink.lockedNotice();
    return notice ? (
      <div class="text-xs text-ink-extra-muted/60">{notice}</div>
    ) : (
      props.header
    );
  };

  return (
    <ComposeProvider value={ctx}>
      <div class="relative">
        <ComposeLayout
          bodyDebugName={`chat-compose:${props.debugName}`}
          class={cn(
            'flex flex-col w-full text-xs rounded-lg p-4 bg-surface',
            uiDisabled() &&
              '[&_button:disabled]:opacity-50 [&_button:disabled]:text-ink-disabled [&_input:disabled]:text-ink-muted'
          )}
          header={header()}
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
