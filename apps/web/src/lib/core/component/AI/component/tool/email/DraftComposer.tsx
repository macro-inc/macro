/**
 * The email composer for a drafted `SendEmail` call, with no opinion about
 * where the draft came from or where the decision goes.
 *
 * Chat mounts it over a pending user tool and sends through the cognition
 * endpoints; an agent session mounts it over a review elicitation and answers
 * the agent. Both hand in a {@link UserToolReviewSink}; the composer only
 * knows how to edit the draft and what Send means.
 */

import { SignaturePreview } from '@app/features/email-compose/components/signature-preview';
import { ComposeProvider } from '@app/features/email-compose/context/compose-context';
import { attachmentLimitBytes } from '@app/features/email-compose/core/constants';
import { decodeBase64Utf8 } from '@app/features/email-compose/core/decode-base64';
import type { EmailRecipient } from '@app/features/email-compose/core/email-recipient';
import { fromInboxOptions } from '@app/features/email-compose/core/email-sender';
import { convertContactInfoToEmailRecipient } from '@app/features/email-compose/core/recipient-conversion';
import { createComposeBodyActions } from '@app/features/email-compose/editor-adapter';
import { makeAttachmentPublic } from '@app/features/email-compose/make-attachment-public';
import { partitionByAttachmentLimit } from '@app/features/email-compose/primitives/attachment-limit';
import { createAttachmentLinkOffer } from '@app/features/email-compose/primitives/attachment-links';
import type {
  ComposeContextValue,
  ComposeValidationError,
} from '@app/features/email-compose/primitives/compose-view-state';
import type { DraftFormAttachment } from '@app/features/email-compose/primitives/email-form-state';
import { prepareEmailBody } from '@app/features/email-compose/primitives/prepare-email-body';
import { uploadAttachmentDocuments } from '@app/features/email-compose/upload-documents';
import { ComposeLayout } from '@app/features/email-compose/views/compose-layout';
import { EmailComposeToolbar } from '@app/features/email-compose/views/compose-toolbar';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import { enableEmailSignatures } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { interceptMailtoLinks } from '@core/util/interceptMailtoLinks';
import { forceDssRuleset, uploadFile } from '@core/util/upload';
import {
  findPrimaryEmailLinkId,
  useEmailLinksQuery,
  useEmailSignature,
  useMessageInboxQuery,
} from '@queries/email/link';
import { queryReadyGate } from '@queries/gate';
import { fetchDocumentMetadata } from '@queries/storage/document-metadata';
import { entityKeys } from '@queries/storage/keys';
import type { SendEmail } from '@service-cognition/generated/tools/types';
import { FileTypeMap } from '@service-storage/fileTypeMap';
import { debounce } from '@solid-primitives/scheduled';
import { useQueryClient } from '@tanstack/solid-query';
import { Button, ComposerSurface, cn, confirmDialog } from '@ui';
import type { LexicalEditor } from 'lexical';
import {
  type ComponentProps,
  createMemo,
  createSignal,
  getOwner,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import type { UserToolReviewSink } from '../user-tool-review';
import {
  createDraftAttachments,
  type DocumentDescription,
  documentAttachmentFileName,
} from './draft-attachments';
import { resolveSendingInbox } from './sending-inbox';

export type EmailDraftComposerProps = {
  /** The draft as the agent wrote it, or as the user last saved it. */
  initialData: SendEmail;
  /** Where edits, the send and the rejection go. */
  sink: UserToolReviewSink<SendEmail>;
  /** Allow a surrounding stack to capture the latest edit before navigation or sending all. */
  registerDraftReader?: (reader: () => SendEmail | undefined) => void;
  /** Prepare the current editor for a batch, waiting for uploads and validation. */
  registerSubmitReader?: (reader: () => Promise<SendEmail | undefined>) => void;
  /** Extra recipients to offer in the pickers. */
  recipientOptions?: EmailRecipient[];
  /** Shown above the form; the sink's locked notice takes precedence. */
  header?: JSX.Element;
  /** A finished email, shown as it was sent: no toolbar, nothing editable. */
  readOnly?: boolean;
  /** Suffix for the body editor's debug name, unique per draft. */
  debugName: string;
  /** The imported body in the same encoding used for subsequent edits. */
  onBodyInitialized?: (bodyHtml: string) => void;
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

function DraftComposerSurface(props: ComponentProps<typeof ComposerSurface>) {
  return <ComposerSurface {...props} as="div" />;
}

/** Uploads a user-added file as a Macro document, the form the send attaches. */
async function uploadAttachmentDocument(
  file: File
): Promise<{ documentId: string } | undefined> {
  const result = await uploadFile(file, forceDssRuleset, {
    hideProgressIndicator: true,
  });
  if (
    result.failed ||
    result.destination !== 'dss' ||
    result.type !== 'document'
  ) {
    toast.failure(`Failed to attach ${file.name}`);
    return undefined;
  }
  return { documentId: result.documentId };
}

export function EmailDraftComposer(props: EmailDraftComposerProps) {
  const uiDisabled = () => !props.sink.canAct() || props.readOnly === true;
  const userId = useUserId();
  const emailLinksQuery = useEmailLinksQuery();
  const inboxes = createMemo(() =>
    queryReadyGate(emailLinksQuery) ? (emailLinksQuery.data.links ?? []) : []
  );
  // Keep the selected address even if its inbox is later disconnected, so
  // edits cannot silently replace an explicit sender.
  const [chosenInbox, setChosenInbox] = createSignal<{
    id: string;
    address: string;
  }>();
  const explicitFrom = () =>
    chosenInbox()?.address || props.initialData.from?.trim() || undefined;
  const replyInboxQuery = useMessageInboxQuery(() =>
    explicitFrom() ? undefined : (props.initialData.replyingToId ?? undefined)
  );
  const sendingLink = createMemo(() => {
    const list = inboxes();
    return resolveSendingInbox(list, {
      chosenInboxId: chosenInbox()?.id,
      draftFrom: props.initialData.from,
      isReply: Boolean(props.initialData.replyingToId),
      replyTargetInboxId: queryReadyGate(replyInboxQuery)
        ? (replyInboxQuery.data ?? undefined)
        : undefined,
      primaryInboxId:
        findPrimaryEmailLinkId(list, userId()) ??
        list.find((link) => link.macro_id === userId())?.id,
    });
  });
  const fromAddress = () => explicitFrom() ?? sendingLink()?.email_address;
  const senderNotice = () => {
    if (sendingLink()) return undefined;
    if (emailLinksQuery.isPending) return 'Resolving sender...';
    if (!queryReadyGate(emailLinksQuery)) {
      return 'Could not load your inboxes. Try again.';
    }
    if (explicitFrom()) {
      return `${explicitFrom()} is unavailable. Choose a connected sending inbox.`;
    }
    if (props.initialData.replyingToId) {
      if (replyInboxQuery.isPending || replyInboxQuery.isFetching) {
        return 'Resolving sender...';
      }
      return 'Could not resolve the reply sender. Try again or choose a sending inbox.';
    }
    return 'Connect an inbox to send email.';
  };
  const canRetrySender = () =>
    !sendingLink() &&
    (emailLinksQuery.isError || (!explicitFrom() && replyInboxQuery.isError));
  const retrySender = async () => {
    if (emailLinksQuery.isError) await emailLinksQuery.refetch();
    if (!explicitFrom() && replyInboxQuery.isError)
      await replyInboxQuery.refetch();
  };
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
  const [bodyInitialized, setBodyInitialized] = createSignal(false);
  const [validationErrors, setValidationErrors] = createSignal<
    ComposeValidationError[]
  >([]);
  let finalized = false;

  const queryClient = useQueryClient();
  const describeDocument = async (
    documentId: string
  ): Promise<DocumentDescription> => {
    const metadata = await queryClient.fetchQuery({
      queryKey: entityKeys.documentMetadata(documentId).queryKey,
      queryFn: () => fetchDocumentMetadata(documentId),
      staleTime: 60 * 1000,
    });
    const fileType = metadata.fileType ?? undefined;
    return {
      fileName: documentAttachmentFileName(metadata.documentName, fileType),
      mimeType: fileType
        ? FileTypeMap[fileType as keyof typeof FileTypeMap]?.mime
        : undefined,
    };
  };
  const attachments = createDraftAttachments({
    initial: props.initialData.attachments,
    describe: describeDocument,
    upload: uploadAttachmentDocument,
    onChange: () => scheduleUpdate(),
  });
  // Attach handlers run as event handlers without a Solid owner; the dialog needs this one.
  const dialogOwner = getOwner();
  const attachmentLinks = createAttachmentLinkOffer({
    editor,
    canEdit: () => !isSending() && !uiDisabled() && !finalized,
    version: () => `${sendingLink()?.id ?? ''}:${fromAddress() ?? ''}`,
    notices: {
      confirm: (input) => confirmDialog(input, { owner: dialogOwner }),
    },
    editorFiles: {
      uploadDocuments: uploadAttachmentDocuments,
      makePublic: makeAttachmentPublic,
    },
  });

  function collectArgs(): SendEmail {
    return {
      to: fromEmailRecipients(recipients().to),
      cc: fromEmailRecipients(recipients().cc),
      bcc: fromEmailRecipients(recipients().bcc),
      subject: subject(),
      body: bodyInitialized()
        ? (prepareEmailBody(editor())?.bodyHtml ?? props.initialData.body)
        : props.initialData.body,
      replyingToId: props.initialData.replyingToId,
      // Preserve explicit choices; the backend resolves implicit senders.
      from: explicitFrom(),
      // Omit to use the backend default policy; false only when dismissed.
      includeSignature: includeSignature() ? undefined : false,
      attachments: attachments.toToolArgs(),
    };
  }

  props.registerDraftReader?.(() =>
    !bodyInitialized() || attachments.uploading() || attachmentLinks.uploading()
      ? undefined
      : collectArgs()
  );
  props.registerSubmitReader?.(async () => {
    if (!bodyInitialized()) return;
    await attachmentLinks.settled();
    if (!(await attachments.waitForUploads()) || !sendingLink() || !validate())
      return;
    debouncedEdit.clear();
    return collectArgs();
  });

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
    attachmentLinks.detach();
    props.sink.onDispose?.();
  });

  async function handleSend() {
    if (
      finalized ||
      uiDisabled() ||
      isSending() ||
      attachments.uploading() ||
      attachmentLinks.uploading() ||
      !sendingLink()
    )
      return;
    if (!validate()) return;
    debouncedEdit.clear();
    setIsSending(true);
    const done = await props.sink.onExecute(collectArgs());
    setIsSending(false);
    if (done) {
      finalized = true;
      attachmentLinks.detach();
    }
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
    bodyActions: createComposeBodyActions(),
    isMobile,
    // The AI tool has its own execute contract and does not expose scheduled send.
    scheduleEnabled: false,
    subject,
    attachments: attachments.list,
    schedule: {
      state: () => ({ type: 'editing', intent: { type: 'immediate' } }),
      selectedTime: () => undefined,
      confirmedTime: () => undefined,
      actionLabel: () => 'Send email',
      operation: () => 'idle',
      onSelect: () => false,
      onCancel: async () => false,
      pickerDisabled: () => true,
    },
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
    onAddAttachments: (files: File[]) => {
      if (uiDisabled()) return;
      const limit = attachmentLimitBytes(sendingLink()?.provider);
      const { attachable, oversized } = partitionByAttachmentLimit(
        files,
        attachments.list(),
        limit
      );
      attachments.add(attachable.map((file) => ({ type: 'local', file })));
      fireAndForget(attachmentLinks.share(oversized, limit), 'ai-email-draft');
    },
    onRemoveAttachment: (attachment: DraftFormAttachment) => {
      if (uiDisabled()) return;
      attachments.remove(attachment);
    },
    captureEditor: setEditor,
    onEditorInitialized: (editor) => {
      setBodyInitialized(true);
      props.onBodyInitialized?.(prepareEmailBody(editor)?.bodyHtml ?? '');
    },
    onSend: handleSend,
    disabled: () => isSending() || uiDisabled(),
    // Send waits for files the user just added to finish becoming documents.
    primaryActionDisabled: () =>
      isSending() ||
      uiDisabled() ||
      attachments.uploading() ||
      attachmentLinks.uploading() ||
      !sendingLink(),
    isSending,
    isSavingDraft: () => false,
    hasDraft: () => false,
    hasPaidAccess: () => true,
    focusRecipientsOnMount: false,
    includeSelf: true,
    hideAttachments: props.readOnly === true,
    recipientOptions: () => [
      ...recipients().to,
      ...recipients().cc,
      ...recipients().bcc,
      ...(props.recipientOptions ?? []),
    ],
    validationError: (type) => validationErrors().find((e) => e.type === type),
    fromAddress,
    fromInboxes: () => fromInboxOptions(inboxes()),
    selectedInboxId: () => sendingLink()?.id,
    onSelectInbox: (inboxId) => {
      if (uiDisabled() || isSending()) return;
      const inbox = inboxes().find((link) => link.id === inboxId);
      if (!inbox) return;
      setChosenInbox({ id: inbox.id, address: inbox.email_address });
      scheduleUpdate();
    },
    recipients,
    // Read-only preview of the signature the backend appends on send, with a ✕
    // to drop it for this one email (persisted through the sink's edit).
    signaturePreview: () => (
      <Show when={previewSignatureHtml()}>
        {(html) => (
          <SignaturePreview
            mobile={isMobile()}
            prepareLinks={interceptMailtoLinks}
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
          as={DraftComposerSurface}
          bodyDebugName={`chat-compose:${props.debugName}`}
          class={cn(
            'relative flex flex-col w-full text-xs p-4 touch:pt-4',
            isTouchDevice() && 'rounded-lg bg-surface',
            uiDisabled() &&
              '[&_button:disabled]:opacity-50 [&_button:disabled]:text-ink-disabled [&_input:disabled]:text-ink-muted'
          )}
          header={header()}
          notice={
            <Show when={!props.readOnly && senderNotice()}>
              {(notice) => (
                <div
                  role="status"
                  class="flex flex-wrap items-center gap-2 text-sm text-ink-muted"
                >
                  <span>{notice()}</span>
                  <Show when={canRetrySender()}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={uiDisabled()}
                      onClick={retrySender}
                    >
                      Retry
                    </Button>
                  </Show>
                </div>
              )}
            </Show>
          }
          toolbar={
            props.readOnly === true ? undefined : (
              <EmailComposeToolbar editor={editor} inline />
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
