import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { useHasPaidAccess } from '@core/auth';
import { CircleSpinner } from '@core/component/CircleSpinner';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { toast } from '@core/component/Toast/Toast';
import { useEmailLinks } from '@core/email-link';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import {
  type ContactInfo,
  tryMacroId,
  useDisplayName,
  type WithCustomUserInput,
} from '@core/user';
import Caution from '@icon/regular/warning.svg';
import { useEmailLinksQuery } from '@queries/email/link';
import {
  useSendMessageMutation,
  useUnscheduleMessageMutation,
} from '@queries/email/thread';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { beveledCorners } from '../../block-theme/signals/themeSignals';
import { ComposeEmailInput } from './ComposeEmailInput';
import {
  createEmailFormState,
  type DraftFormAttachment,
} from '@block-email/component/createEmailFormState';
import { logger } from '@observability/logger';
import { debounce } from '@solid-primitives/scheduled';
import type { LexicalEditor } from 'lexical';
import {
  $appendWatermarkNodeToLast,
  $removeAllWatermarkNodes,
} from '@lexical-core';
import {
  clearEmailBody,
  hasDraftContent,
  prepareEmailBody,
} from '@block-email/util/prepareEmailBody';
import { convertEmailRecipientToContactInfo } from '@block-email/util/recipientConversion';
import {
  useDeleteDraftMutation,
  useSaveDraftMutation,
} from '@queries/email/draft';
import {
  useRemoveDraftAttachmentMutation,
  useRemoveForwardedAttachmentMutation,
  useUploadDraftAttachmentsMutation,
} from '@queries/email/attachment';
import { MACRO_EMAIL_SIGNATURE } from '@block-email/constants';
import {
  type EmailRecipient,
  useMaybeEmailContext,
} from '@block-email/component/EmailContext';
import { decodeBase64Utf8 } from '@block-email/util/decodeBase64';
import { plainTextToHtml } from '@block-email/util/plainTextToHtml';
import { stickyGate } from '@core/util/debounce';
import { invalidateSoupEntity } from '@queries/soup/cache';
import { WrapUnlessMobile } from '@core/mobile/WrapUnlessMobile';
import { isMobile } from '@core/mobile/isMobile';
import { $generateHtmlFromNodes } from '@lexical/html';
import type { EmailFormRecipients } from '@block-email/component/createEmailFormState';
import { unwrap } from 'solid-js/store';
import { emailClient } from '@service-email/client';
import { queryClient } from '@queries/client';
import { emailKeys } from '@queries/email/keys';

const DRAFT_DEBOUNCE_MS = 1000;

type UndoComposeSnapshot = {
  draftId: string;
  recipients: EmailFormRecipients;
  subject: string;
  bodyHtml: string;
  attachments: DraftFormAttachment[];
};

let undoComposeSnapshot: UndoComposeSnapshot | null = null;

type EmailComposeErrors =
  | 'no_recipient'
  | 'no_message'
  | 'no_subject'
  | 'no_link';

class EmailComposeError {
  constructor(
    public type: EmailComposeErrors,
    public message: string
  ) {}
}

type EmailComposeElementRefs = {
  directRecipientsSelector: HTMLElement | undefined;
  ccRecipientsSelector: HTMLElement | undefined;
  bccRecipientsSelector: HTMLElement | undefined;
  containerRef: HTMLElement | undefined;
  subjectInput: HTMLElement | undefined;
  messageInput: HTMLElement | undefined;
};

type EmailComposeProps = {
  draftID?: string;
};

type RecipientFieldId = 'to' | 'cc' | 'bcc';

type DragState = {
  recipient: EmailRecipient;
  sourceField: RecipientFieldId;
};

function ComposeFieldRow(props: {
  label: string;
  children: JSX.Element;
  fieldId?: RecipientFieldId;
  dragState?: Accessor<DragState | null>;
  onRecipientDrop?: (
    recipient: EmailRecipient,
    sourceField: RecipientFieldId
  ) => void;
}) {
  const [isDragOver, setIsDragOver] = createSignal(false);

  const handleDragOver = (e: DragEvent) => {
    const drag = props.dragState?.();
    if (!drag || !props.fieldId || drag.sourceField === props.fieldId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const drag = props.dragState?.();
    if (!drag || !props.fieldId || drag.sourceField === props.fieldId) return;
    props.onRecipientDrop?.(drag.recipient, drag.sourceField);
  };

  return (
    <div
      class="flex items-center gap-2 border-b border-edge-muted focus-within:border-accent"
      classList={{ 'border-accent bg-accent/10': isDragOver() }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div class="text-sm w-7 shrink-0 text-ink-placeholder/70">
        {props.label}
      </div>
      <div class="flex-1">{props.children}</div>
    </div>
  );
}

export function EmailCompose(props: EmailComposeProps) {
  const hasPaidAccess = useHasPaidAccess();
  const emailLinksQuery = useEmailLinksQuery();

  const [refs, setRefs] = createSignal<EmailComposeElementRefs>({
    directRecipientsSelector: undefined,
    ccRecipientsSelector: undefined,
    bccRecipientsSelector: undefined,
    containerRef: undefined,
    subjectInput: undefined,
    messageInput: undefined,
  });

  let mobileScrollRef: HTMLDivElement | undefined;

  const registerRef = (name: keyof EmailComposeElementRefs) => {
    return (el: HTMLElement) => {
      setRefs((p) => ({ ...p, [name]: el }));
    };
  };

  const [attachComposeHotkeys, composeHotkeyScope] =
    useHotkeyDOMScope('compose-email');

  const link = createMemo(() => {
    const data = emailLinksQuery.data;
    if (data && data.links.length > 0) {
      return data.links[0];
    }
    return undefined;
  });

  const hasLinkError = createMemo(() => {
    if (emailLinksQuery.isPending) return false;
    return (
      emailLinksQuery.isError ||
      (emailLinksQuery.data && emailLinksQuery.data.links.length === 0)
    );
  });

  const { users: destinationOptions } = useCombinedRecipients();

  const emailContext = useMaybeEmailContext();

  const form = createEmailFormState(
    props.draftID
      ? {
          type: 'draft',
          messageID: props.draftID,
        }
      : undefined,
    emailContext
      ? {
          getMessageByID: (id) =>
            emailContext.messages.unfiltered().find((m) => m.db_id === id),
          getDraftForMessageReply: emailContext.drafts.getDraftForMessage,
          onRecipientsChange: emailContext.onRecipientsChange,
        }
      : undefined
  );

  const [editor, setEditor] = createSignal<LexicalEditor | undefined>();

  const [content, setContent] = createSignal('');
  const [currentDraftID, setCurrentDraftID] = createSignal<string | undefined>(
    props.draftID
  );

  // Restore form state from undo-send snapshot if available
  const restoredSnapshot =
    undoComposeSnapshot?.draftId === props.draftID ? undoComposeSnapshot : null;
  if (restoredSnapshot) {
    form.setRecipients('to', restoredSnapshot.recipients.to);
    form.setRecipients('cc', restoredSnapshot.recipients.cc);
    form.setRecipients('bcc', restoredSnapshot.recipients.bcc);
    form.setSubject(restoredSnapshot.subject);
    for (const attachment of restoredSnapshot.attachments) {
      form.attachments.add(attachment);
    }
    undoComposeSnapshot = null;
  }

  const uploadAttachmentMutation = useUploadDraftAttachmentsMutation();
  const saveDraftMutation = useSaveDraftMutation();
  const deleteDraftMutation = useDeleteDraftMutation();

  function collectDraft() {
    $removeAllWatermarkNodes(editor());
    const prepared = prepareEmailBody(editor());
    if (!prepared) {
      logger.error(
        new Error('Unable to prepare email body for draft collection.')
      );
      return null;
    }
    if (
      !hasDraftContent(
        prepared.bodyText,
        form.subject(),
        form.attachments.list().length
      )
    ) {
      return null;
    }
    // We attach the drafts entirely using bodyHTML (because this is how the appended reply parsing works) so we are not including bodyMacro or bodyText
    return {
      bcc: form.recipients().bcc.map(convertEmailRecipientToContactInfo),
      body_html: prepared.bodyHtml,
      cc: form.recipients().cc.map(convertEmailRecipientToContactInfo),
      subject: form.subject(),
      to: form.recipients().to.map(convertEmailRecipientToContactInfo),
    };
  }

  async function executeSaveDraft() {
    if (sendMutation.isPending) {
      return;
    }
    const draftToSave = collectDraft();
    if (!draftToSave) {
      const draftID = currentDraftID();
      if (draftID) {
        await deleteDraftMutation.mutateAsync({ draftId: draftID });
      }
      setCurrentDraftID(undefined);
      return;
    }

    const draftResponse = await saveDraftMutation.mutateAsync({
      draft: {
        ...draftToSave,
        db_id: currentDraftID(),
      },
    });

    const draftId = draftResponse.draft.db_id;
    if (draftId) {
      // If the email draft saved successfully, we want to upload the
      // attachments as well. We should grab only the attachments that
      // haven't been uploaded yet
      const attachments = form.attachments
        .list()
        .filter((a) => a.type === 'local' && !a.attachmentID) as Extract<
        DraftFormAttachment,
        { type: 'local' }
      >[];

      if (attachments.length) {
        const uploaded = await uploadAttachmentMutation.mutateAsync({
          draftID: draftId,
          attachments: attachments.map((a) => a.file),
        });

        // Assign the attachment ids to attachments for later use
        for (const attachment of uploaded.attachments) {
          form.attachments.assignAttachmentID(
            attachment.file,
            attachment.attachmentID
          );
        }
      }

      setCurrentDraftID(draftId);

      return draftId;
    }
  }

  const scheduleDraftSave = debounce(() => {
    void executeSaveDraft();
  }, DRAFT_DEBOUNCE_MS);

  const withDraftSave =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      scheduleDraftSave();
    };

  const onAddAttachments = (attachments: DraftFormAttachment[]) => {
    for (const attachment of attachments) {
      form.attachments.add(attachment);
    }
    scheduleDraftSave();
  };

  const removeAttachmentMutation = useRemoveDraftAttachmentMutation();
  const removeForwardedAttachmentMutation =
    useRemoveForwardedAttachmentMutation();

  const handleRemoveAttachment = (attachment: DraftFormAttachment) => {
    if (attachment.type === 'local') {
      form.attachments.removeByFile(attachment.file);
    } else if (attachment.type === 'forwarded') {
      form.attachments.removeForwarded(attachment.attachmentID);
    } else {
      form.attachments.removeByID(attachment.attachmentID);
    }

    const savedDraftID = currentDraftID();

    if (!savedDraftID || !attachment.attachmentID) return;

    if (attachment.type === 'forwarded') {
      removeForwardedAttachmentMutation.mutate({
        draftID: savedDraftID,
        attachmentID: attachment.attachmentID,
      });
    } else {
      removeAttachmentMutation.mutate({
        draftID: savedDraftID,
        attachmentID: attachment.attachmentID,
      });
    }
  };

  // We are consuming the first change, because it is the initial value
  let firstChangeConsumed = false;
  const onContentChange = (content: string) => {
    setContent(content);
    if (!firstChangeConsumed) {
      firstChangeConsumed = true;
      return;
    }
    scheduleDraftSave();
  };

  const [showCc, setShowCc] = createSignal(false);
  const [showBcc, setShowBcc] = createSignal(false);

  const isCcVisible = () => showCc() || form.recipients().cc.length > 0;
  const isBccVisible = () => showBcc() || form.recipients().bcc.length > 0;

  onMount(() => {
    const container = refs().containerRef;
    if (!container) return;
    attachComposeHotkeys(container);
  });

  registerHotkey({
    hotkey: 'shift+cmd+o',
    scopeId: composeHotkeyScope,
    description: 'Edit "To" recipients',
    keyDownHandler: () => {
      refs()?.directRecipientsSelector?.focus();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.recipients,
    shouldReturnFocusOnClose: false,
  });

  registerHotkey({
    hotkey: 'shift+cmd+c',
    scopeId: composeHotkeyScope,
    description: 'Edit "Cc" recipients',
    keyDownHandler: () => {
      const visible = showCc();
      if (!visible) {
        setShowCc(true);
        queueMicrotask(() => refs()?.ccRecipientsSelector?.focus());
        return true;
      }

      refs()?.ccRecipientsSelector?.focus();

      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.ccRecipients,
    shouldReturnFocusOnClose: false,
  });

  registerHotkey({
    hotkey: 'shift+cmd+b',
    scopeId: composeHotkeyScope,
    description: 'Edit "Bcc" recipients',
    keyDownHandler: () => {
      const visible = showBcc();
      if (!visible) {
        setShowBcc(true);
        queueMicrotask(() => refs()?.bccRecipientsSelector?.focus());
        return true;
      }

      refs()?.bccRecipientsSelector?.focus();

      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.bccRecipients,
    shouldReturnFocusOnClose: false,
  });

  registerHotkey({
    hotkey: 'shift+cmd+s',
    scopeId: composeHotkeyScope,
    description: 'Edit subject',
    keyDownHandler: () => {
      refs()?.subjectInput?.focus();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.subject,
    shouldReturnFocusOnClose: false,
  });

  registerHotkey({
    hotkey: 'shift+cmd+m',
    scopeId: composeHotkeyScope,
    description: 'Edit message',
    keyDownHandler: () => {
      refs()?.messageInput?.focus();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.message,
    shouldReturnFocusOnClose: false,
  });

  const { connect: connectEmail } = useEmailLinks();

  const previewName = createMemo(() => {
    const recipients = form.recipients().to;
    if (recipients.length === 0) {
      return 'Draft email';
    }

    if (recipients.length === 1) {
      let recipientName = recipients[0].data.email;

      if (recipients[0].kind === 'user') {
        recipientName = useDisplayName(tryMacroId(recipients[0].data.id))[0]();
      }

      return recipientName ? `Email to ${recipientName}` : 'Draft email';
    }

    const names = recipients
      .slice(0, 2)
      .map((r) => {
        if (r.kind === 'user') {
          return useDisplayName(tryMacroId(r.data.id))[0]();
        }
        return r.data.email || 'Unknown';
      })
      .filter(Boolean);

    if (recipients.length > 2) {
      return `Email to ${names.join(', ')}, and others`;
    }

    return `Email to ${names.join(' and ')}`;
  });

  const { replaceSplit } = useSplitLayout();

  const [validationError, setValidationError] =
    createSignal<EmailComposeError | null>(null);

  const undoSend = async (draftId: string) => {
    try {
      await emailClient.unscheduleMessage({ draftID: draftId });
      queryClient.invalidateQueries({
        queryKey: emailKeys.previews._def,
      });
      replaceSplit({
        content: {
          type: 'component',
          id: 'email-compose',
          params: { draftID: draftId },
        },
      });
      toast.success('Send cancelled');
      invalidateSoupEntity(draftId);
    } catch {
      toast.failure('Failed to undo send');
    }
  };

  const sendMutation = useSendMessageMutation({
    onSuccess: (data) => {
      const draftId = data.message.db_id;
      const toastId = toast.success(
        'Email sent',
        undefined,
        draftId
          ? {
              text: 'Undo',
              onClick: () => {
                if (toastId != null) toast.dismiss(toastId);
                void undoSend(draftId);
              },
            }
          : undefined,
        10_000
      );
      if (data.message.thread_db_id) {
        replaceSplit({
          content: { type: 'email', id: data.message.thread_db_id },
          mergeHistory: true,
        });
      }
    },
    onError: () => {
      toast.failure('Failed to send email');
    },
  });

  const onSubmit = async () => {
    setValidationError(null);

    const currentEditor = editor();

    // Snapshot editor state before watermark so undo-send can restore it
    if (currentEditor) {
      const snapshotHtml = currentEditor.read(() =>
        $generateHtmlFromNodes(currentEditor)
      );
      const draftId = currentDraftID();
      if (draftId) {
        undoComposeSnapshot = {
          draftId,
          recipients: structuredClone(unwrap(form.recipients())),
          subject: form.subject(),
          bodyHtml: snapshotHtml,
          attachments: [...form.attachments.list()],
        };
      }
    }

    // We handle cleaning up the signature after we've sent the request because
    // otherwise the `bodyMacro` signal would update after the clean up call and
    // not contain the signature in the request data
    const cleanupWatermark = $appendWatermarkNodeToLast(
      currentEditor,
      !hasPaidAccess() ? MACRO_EMAIL_SIGNATURE : undefined
    );

    const prepared = prepareEmailBody(currentEditor, undefined);
    if (!prepared) return;

    const bodyMacro = content();

    const data = {
      text: prepared.bodyText,
      html: prepared.bodyHtml,
      raw: bodyMacro,
    };

    const currentLink = link();

    const recipients = form.recipients();

    if (!recipients.to.length) {
      setValidationError(
        new EmailComposeError(
          'no_recipient',
          'Please select at least one recipient'
        )
      );
      return;
    }

    if (!data.raw.trim()) {
      setValidationError(
        new EmailComposeError('no_message', 'Please enter a message')
      );
      return;
    }

    if (!form.subject()?.trim()) {
      setValidationError(
        new EmailComposeError('no_subject', 'Please enter a subject')
      );
      return;
    }

    if (!currentLink) {
      setValidationError(
        new EmailComposeError('no_link', 'Unable to find linked email account')
      );
      return;
    }

    // Failsafe: don't send if a scheduled send time is set
    if (form.sendTime()) {
      return;
    }

    sendMutation.mutate({
      message: {
        to: convertToContactInfoArray(recipients.to),
        cc:
          recipients.cc.length > 0
            ? convertToContactInfoArray(recipients.cc)
            : [],
        bcc:
          recipients.bcc.length > 0
            ? convertToContactInfoArray(recipients.bcc)
            : [],
        subject: form.subject(),
        body_text: data.text,
        body_html: data.html,
        body_macro: data.raw,
        db_id: currentDraftID(),
      },
    });

    cleanupWatermark();
  };

  const unscheduleMessageMutation = useUnscheduleMessageMutation({
    onSuccess: (_data, vars) => {
      toast.success('Email unscheduled');
      invalidateSoupEntity(vars.draftID);
    },
    onError: () => {
      toast.failure('Failed to unschedule email');
    },
  });

  const handleSendTimeChange = async (date: Date | null) => {
    const currentSendTime = form.sendTime();
    const currentDraft = currentDraftID();

    // If we unset the send time, we need to unschedule the message
    if (!date && currentSendTime && currentDraft) {
      unscheduleMessageMutation.mutate({
        draftID: currentDraft,
      });
      form.setSendTime(date);
      return;
    }

    form.setSendTime(date);

    if (date) {
      // Ensure draft is saved before scheduling
      const draftID = currentDraft ?? (await executeSaveDraft());
      if (!draftID) {
        toast.failure('Failed to schedule message', 'Draft required');
        return;
      }

      await emailClient.scheduleMessage({
        draftID,
        send_time: date.toISOString(),
      });

      // Mark the thread as done
      const threadID = saveDraftMutation.data?.draft.thread_db_id;
      if (threadID) {
        await emailClient.flagArchived({ id: threadID, value: true });
      }
    }
  };

  const resetState = () => {
    clearEmailBody(editor());
    setContent('');
    setCurrentDraftID(undefined);
    form.clear();
  };

  const deleteDraftAndReset = async () => {
    const draftId = currentDraftID();
    if (draftId) {
      await deleteDraftMutation.mutateAsync({ draftId });
    }
    resetState();
  };

  const withValidationError = (type: EmailComposeErrors) => {
    const error = validationError();
    if (error?.type === type) return error;
    return undefined;
  };

  const initialHtml = () => {
    if (restoredSnapshot) {
      return restoredSnapshot.bodyHtml;
    }

    const draft = form.draft;
    if (!draft) return;

    if (draft.body_html_sanitized) {
      return decodeBase64Utf8(draft.body_html_sanitized);
    }

    if (draft.body_text) {
      return plainTextToHtml(draft.body_text);
    }
  };

  const getRecipientOptions = () => {
    // If we're being displayed for a draft,
    // we should get the recipients from the draft
    const fromDraft = emailContext?.recipientOptions();

    return fromDraft ?? destinationOptions();
  };

  const [recipientDragState, setRecipientDragState] =
    createSignal<DragState | null>(null);

  const handleChipDragStart = (
    field: RecipientFieldId,
    recipient: EmailRecipient,
    e: DragEvent
  ) => {
    if (!e.dataTransfer) return;
    setRecipientDragState({ recipient, sourceField: field });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  };

  const handleChipDragEnd = () => {
    setRecipientDragState(null);
  };

  const handleRecipientDrop = (
    targetField: RecipientFieldId,
    recipient: EmailRecipient,
    sourceField: RecipientFieldId
  ) => {
    // Remove from source
    const sourceList = form.recipients()[sourceField];
    form.setRecipients(
      sourceField,
      sourceList.filter((r) => r.id !== recipient.id)
    );
    // Add to target (avoid duplicates)
    const targetList = form.recipients()[targetField];
    if (!targetList.some((r) => r.id === recipient.id)) {
      form.setRecipients(targetField, [...targetList, recipient]);
    }
    // Auto-show cc/bcc if dropping into them
    if (targetField === 'cc') setShowCc(true);
    if (targetField === 'bcc') setShowBcc(true);
    scheduleDraftSave();
  };

  const isDraftSaving = () => saveDraftMutation.isPending;

  const laggedIsDraftSaving = stickyGate(isDraftSaving, 250);

  return (
    <>
      <Show when={!isMobile()}>
        <SplitHeaderLeft>
          <StaticSplitLabel
            label={form.subject() || previewName()}
            iconType={isMobile() ? undefined : 'email'}
            badges={
              isMobile()
                ? []
                : [
                    <SplitHeaderBadge
                      text="draft"
                      tooltip="This is a Draft Email"
                    />,
                  ]
            }
          />
        </SplitHeaderLeft>
      </Show>
      <div
        ref={registerRef('containerRef')}
        class="relative flex flex-col w-full h-full min-h-0 overflow-hidden text-sm"
      >
        <Show when={hasLinkError()}>
          <div class="w-full bg-alert-bg border-b border-t border-alert/20 text-alert-ink p-2">
            <div class="flex items-center justify-between gap-2">
              <Caution class="size-4" />
              <span class="text-sm">
                You have not connected an email account.
              </span>
              <span class="grow" />
              <DeprecatedTextButton
                theme="base"
                text="Connect Email"
                onClick={connectEmail}
              />
            </div>
          </div>
        </Show>

        <div
          ref={mobileScrollRef}
          class="macro-message-width sm:macro-message-padding mx-auto w-full max-h-full my-2 sm:my-12 mobile:my-0 px-2 sm:px-4 mobile:px-0 overflow-hidden mobile:overflow-y-auto mobile:hide-scrollbar mobile:min-h-full"
          classList={{
            'pointer-events-none opacity-50': hasLinkError(),
          }}
        >
          <WrapUnlessMobile
            wrapper={(children) => (
              <ClippedPanel tl={!beveledCorners()}>{children}</ClippedPanel>
            )}
          >
            <div
              class="w-full p-4 bg-input max-h-full mobile:max-h-none overflow-y-auto flex flex-col min-h-0 mobile:min-h-full"
              classList={{
                'pointer-events-none opacity-50': hasLinkError(),
              }}
            >
              <div class="macro-message-width mx-auto pb-1 w-full h-max shrink-0">
                <div class="mb-4 h-6 flex items-center justify-between">
                  <Suspense
                    fallback={
                      <div class="flex gap-1 items-center">
                        <CircleSpinner class="w-4 h-4 animate-spin" />
                        <span class="text-ink-extra-muted/50 text-xs">
                          Processing...
                        </span>
                      </div>
                    }
                  >
                    <Show when={link()}>
                      {(link) => (
                        <div class="text-xs text-ink-extra-muted/50">
                          from {link().email_address}
                        </div>
                      )}
                    </Show>
                  </Suspense>
                  <div class="flex gap-2 ml-auto">
                    <Show when={!isCcVisible()}>
                      <button
                        type="button"
                        class="text-ink-muted hover:text-ink hover:bg-hover"
                        onClick={() => setShowCc(true)}
                        disabled={hasLinkError()}
                      >
                        + Cc
                      </button>
                    </Show>
                    <Show when={!isBccVisible()}>
                      <button
                        type="button"
                        class="text-ink-muted hover:text-ink hover:bg-hover"
                        onClick={() => setShowBcc(true)}
                        disabled={hasLinkError()}
                      >
                        + Bcc
                      </button>
                    </Show>
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <ComposeFieldRow
                    label="To"
                    fieldId="to"
                    dragState={recipientDragState}
                    onRecipientDrop={(recipient, sourceField) =>
                      handleRecipientDrop('to', recipient, sourceField)
                    }
                  >
                    <RecipientSelector
                      inputRef={registerRef('directRecipientsSelector')}
                      options={getRecipientOptions}
                      selectedOptions={form.recipients().to}
                      setSelectedOptions={withDraftSave((next) =>
                        form.setRecipients('to', next)
                      )}
                      placeholder="Macro users or email addresses"
                      focusOnMount={!hasLinkError()}
                      hideBorder
                      noBrackets
                      disabled={hasLinkError()}
                      onChipDragStart={(option, e) =>
                        handleChipDragStart('to', option, e)
                      }
                      onChipDragEnd={handleChipDragEnd}
                    />
                    <Show when={withValidationError('no_recipient')}>
                      {(err) => (
                        <div class="text-failure-ink text-sm mt-1">
                          {err().message}
                        </div>
                      )}
                    </Show>
                  </ComposeFieldRow>

                  <Show when={isCcVisible()}>
                    <ComposeFieldRow
                      label="Cc"
                      fieldId="cc"
                      dragState={recipientDragState}
                      onRecipientDrop={(recipient, sourceField) =>
                        handleRecipientDrop('cc', recipient, sourceField)
                      }
                    >
                      <RecipientSelector
                        inputRef={registerRef('ccRecipientsSelector')}
                        options={getRecipientOptions}
                        selectedOptions={form.recipients().cc}
                        setSelectedOptions={withDraftSave((next) =>
                          form.setRecipients('cc', next)
                        )}
                        placeholder="Macro users or email addresses"
                        hideBorder
                        noBrackets
                        disabled={hasLinkError()}
                        onChipDragStart={(option, e) =>
                          handleChipDragStart('cc', option, e)
                        }
                        onChipDragEnd={handleChipDragEnd}
                      />
                    </ComposeFieldRow>
                  </Show>

                  <Show when={isBccVisible()}>
                    <ComposeFieldRow
                      label="Bcc"
                      fieldId="bcc"
                      dragState={recipientDragState}
                      onRecipientDrop={(recipient, sourceField) =>
                        handleRecipientDrop('bcc', recipient, sourceField)
                      }
                    >
                      <RecipientSelector
                        inputRef={registerRef('bccRecipientsSelector')}
                        options={getRecipientOptions}
                        selectedOptions={form.recipients().bcc}
                        setSelectedOptions={withDraftSave((next) =>
                          form.setRecipients('bcc', next)
                        )}
                        placeholder="Macro users or email addresses"
                        hideBorder
                        noBrackets
                        disabled={hasLinkError()}
                        onChipDragStart={(option, e) =>
                          handleChipDragStart('bcc', option, e)
                        }
                        onChipDragEnd={handleChipDragEnd}
                      />
                    </ComposeFieldRow>
                  </Show>

                  <div class="w-full flex items-center gap-2 border-b border-edge-muted focus-within:border-accent py-2">
                    <div class="shrink-0 text-ink-placeholder/70">Subject</div>

                    <div class="flex-1">
                      <input
                        ref={registerRef('subjectInput')}
                        type="text"
                        value={form.subject()}
                        placeholder="Subject"
                        class="w-full resize-none placeholder:text-ink-placeholder p-1 ml-1"
                        onInput={(e) => {
                          form.setSubject(e.currentTarget.value);
                          scheduleDraftSave();
                        }}
                        disabled={hasLinkError()}
                      />
                    </div>

                    <Show when={withValidationError('no_subject')}>
                      {(err) => (
                        <div class="text-failure-ink text-sm mt-1">
                          {err().message}
                        </div>
                      )}
                    </Show>
                  </div>
                </div>
              </div>

              <div
                class="w-full h-full flex flex-col min-h-0 mt-4"
                classList={{
                  'pointer-events-none opacity-50': hasLinkError(),
                }}
              >
                <ComposeEmailInput
                  captureEditor={setEditor}
                  inputRef={registerRef('messageInput')}
                  mobileScrollRef={() => mobileScrollRef}
                  initialHtml={initialHtml()}
                  onContentChange={onContentChange}
                  onAddAttachments={onAddAttachments}
                  onRemoveAttachment={handleRemoveAttachment}
                  attachments={form.attachments.list()}
                  sendTime={form.sendTime()}
                  onSendTimeChange={handleSendTimeChange}
                  onSubmit={() => void onSubmit()}
                  isSubmitting={sendMutation.isPending}
                  isDraftSaving={laggedIsDraftSaving()}
                  hasDraft={currentDraftID() != null}
                  onDraftDeletePress={deleteDraftAndReset}
                  disabled={hasLinkError() || sendMutation.isPending}
                />
                <Show when={withValidationError('no_message')}>
                  {(err) => (
                    <div class="text-failure-ink mt-1">{err().message}</div>
                  )}
                </Show>
              </div>
            </div>
          </WrapUnlessMobile>
        </div>
      </div>
    </>
  );
}

function convertToContactInfoArray(
  recipients: WithCustomUserInput<'user' | 'contact'>[]
): ContactInfo[] {
  return recipients.map((recipient) => ({
    email: recipient.data.email,
    name:
      'name' in recipient.data ? recipient.data.name || undefined : undefined,
  }));
}
