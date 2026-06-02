import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import { useSplitLayout } from '@app/component/split-layout/layout';
import type { EmailFormRecipients } from '@block-email/component/createEmailFormState';
import {
  createEmailFormState,
  type DraftFormAttachment,
} from '@block-email/component/createEmailFormState';
import { useMaybeEmailContext } from '@block-email/component/EmailContext';
import { MACRO_EMAIL_SIGNATURE } from '@block-email/constants';
import { decodeBase64Utf8 } from '@block-email/util/decodeBase64';
import { plainTextToHtml } from '@block-email/util/plainTextToHtml';
import {
  clearEmailBody,
  hasDraftContent,
  prepareEmailBody,
} from '@block-email/util/prepareEmailBody';
import { convertEmailRecipientToContactInfo } from '@block-email/util/recipientConversion';
import { useHasPaidAccess } from '@core/auth';
import { EmailPermissionsBanner } from '@core/component/EmailPermissionsBanner';
import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import { WrapUnlessMobile } from '@core/mobile/WrapUnlessMobile';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import {
  type ContactInfo,
  tryMacroId,
  useDisplayName,
  type WithCustomUserInput,
} from '@core/user';
import { $generateHtmlFromNodes } from '@lexical/html';
import {
  $appendWatermarkNodeToLast,
  $removeAllWatermarkNodes,
} from '@lexical-core';
import { logger } from '@observability/logger';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { queryClient } from '@queries/client';
import {
  useRemoveDraftAttachmentMutation,
  useRemoveForwardedAttachmentMutation,
  useUploadDraftAttachmentsMutation,
} from '@queries/email/attachment';
import {
  useDeleteDraftMutation,
  useSaveDraftMutation,
} from '@queries/email/draft';
import { emailKeys } from '@queries/email/keys';
import {
  useEmailLinksQuery,
  useNonPrimaryEmailLinkIdHeader,
  usePrimaryEmailLinkId,
} from '@queries/email/link';
import {
  useSendMessageMutation,
  useUnscheduleMessageMutation,
} from '@queries/email/thread';
import { invalidateSoupEntity } from '@queries/soup/cache';
import { emailClient } from '@service-email/client';
import { debounce } from '@solid-primitives/scheduled';
import { Surface } from '@ui';

import type { LexicalEditor } from 'lexical';
import { createEffect, createMemo, createSignal, on, Show } from 'solid-js';
import { unwrap } from 'solid-js/store';
import {
  type ComposeContextValue,
  ComposeProvider,
  type ComposeValidationError,
} from './ComposeContext';
import { ComposeLayout } from './ComposeLayout';
import { EmailComposeToolbar } from './ComposeToolbar';

const DRAFT_DEBOUNCE_MS = 500;

type UndoComposeSnapshot = {
  draftId: string;
  recipients: EmailFormRecipients;
  subject: string;
  bodyHtml: string;
  attachments: DraftFormAttachment[];
};

let undoComposeSnapshot: UndoComposeSnapshot | null = null;

type EmailComposeProps = {
  draftID?: string;
};

export function EmailCompose(props: EmailComposeProps) {
  const hasPaidAccess = useHasPaidAccess();
  const emailLinksQuery = useEmailLinksQuery();
  const uploadAttachmentMutation = useUploadDraftAttachmentsMutation();
  const saveDraftMutation = useSaveDraftMutation();
  const deleteDraftMutation = useDeleteDraftMutation();
  const emailContext = useMaybeEmailContext();

  const primaryLinkId = usePrimaryEmailLinkId();
  const link = createMemo(() => {
    const data = emailLinksQuery.data;
    if (!data || data.links.length === 0) return undefined;
    // Send from the inbox that owns the draft being edited; fall back to the
    // primary inbox for a fresh compose rather than whichever inbox sorts first.
    const draftLinkId = props.draftID
      ? emailContext?.messages
          .unfiltered()
          .find((m) => m.db_id === props.draftID)?.link_id
      : undefined;
    const targetId = draftLinkId ?? primaryLinkId();
    return data.links.find((l) => l.id === targetId) ?? data.links[0];
  });

  const toHeaderLinkId = useNonPrimaryEmailLinkIdHeader();
  // Scope writes to the inbox this compose sends from (its X-Email-Link-Id
  // header), so a non-primary "from" inbox drafts/sends from the right account.
  const headerLinkId = () => toHeaderLinkId(link()?.id);

  const hasLinkError = createMemo(() => {
    if (emailLinksQuery.isPending) return false;
    return (
      emailLinksQuery.isError ||
      (emailLinksQuery.data && emailLinksQuery.data.links.length === 0)
    );
  });

  const { users: destinationOptions } = useCombinedRecipients();

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

  // --- Draft persistence ---

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
        form.attachments.list().length,
        form.recipients().to.length +
          form.recipients().cc.length +
          form.recipients().bcc.length
      )
    ) {
      return null;
    }
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
        await deleteDraftMutation.mutateAsync({
          draftId: draftID,
          linkId: headerLinkId(),
        });
      }
      setCurrentDraftID(undefined);
      return;
    }

    const draftResponse = await saveDraftMutation.mutateAsync({
      draft: {
        ...draftToSave,
        db_id: currentDraftID(),
      },
      linkId: headerLinkId(),
    });

    const draftId = draftResponse.draft.db_id;
    if (draftId) {
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
          linkId: headerLinkId(),
        });

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

  // --- Attachment handling ---

  const removeAttachmentMutation = useRemoveDraftAttachmentMutation();
  const removeForwardedAttachmentMutation =
    useRemoveForwardedAttachmentMutation();

  const handleAddAttachments = (attachments: DraftFormAttachment[]) => {
    for (const attachment of attachments) {
      form.attachments.add(attachment);
    }
    scheduleDraftSave();
  };

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
        linkId: headerLinkId(),
      });
    } else {
      removeAttachmentMutation.mutate({
        draftID: savedDraftID,
        attachmentID: attachment.attachmentID,
        linkId: headerLinkId(),
      });
    }
  };

  // --- Content change ---

  let firstChangeConsumed = false;
  const onContentChange = (newContent: string) => {
    setContent(newContent);
    if (!firstChangeConsumed) {
      firstChangeConsumed = true;
      return;
    }
    scheduleDraftSave();
  };

  // --- Send ---

  const { replaceSplit } = useSplitLayout();

  const [validationError, setValidationError] =
    createSignal<ComposeValidationError | null>(null);

  const undoSend = async (draftId: string) => {
    try {
      await emailClient.unscheduleMessage({ draftID: draftId }, headerLinkId());
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
      const toastId = toast.success('Email sent', {
        actions: draftId
          ? [
              {
                label: 'Undo',
                icon: ArrowCounterClockwise,
                onClick: () => {
                  if (toastId != null) toast.dismiss(toastId);
                  void undoSend(draftId);
                },
              },
            ]
          : undefined,
        duration: 10_000,
        mobile: true,
      });
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

    const currentLink = link();
    const recipients = form.recipients();

    if (!recipients.to.length) {
      setValidationError({
        type: 'no_recipient',
        message: 'Please select at least one recipient',
      });
      return;
    }

    if (!content().trim()) {
      setValidationError({
        type: 'no_message',
        message: 'Please enter a message',
      });
      return;
    }

    if (!form.subject()?.trim()) {
      setValidationError({
        type: 'no_subject',
        message: 'Please enter a subject',
      });
      return;
    }

    if (!currentLink) {
      setValidationError({
        type: 'no_link',
        message: 'Unable to find linked email account',
      });
      return;
    }

    // Failsafe: don't send if a scheduled send time is set
    if (form.sendTime()) {
      return;
    }

    // Append watermark after all validation passes so failed sends don't
    // leave orphaned watermark nodes in the editor tree.
    const cleanupWatermark = $appendWatermarkNodeToLast(
      currentEditor,
      !hasPaidAccess() ? MACRO_EMAIL_SIGNATURE : undefined
    );

    const prepared = prepareEmailBody(currentEditor, undefined);
    if (!prepared) {
      cleanupWatermark();
      return;
    }

    const bodyMacro = content();

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
        body_text: prepared.bodyText,
        body_html: prepared.bodyHtml,
        body_macro: bodyMacro,
        db_id: currentDraftID(),
      },
      linkId: headerLinkId(),
    });

    cleanupWatermark();
  };

  // --- Schedule ---

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

    if (!date && currentSendTime && currentDraft) {
      unscheduleMessageMutation.mutate({
        draftID: currentDraft,
        linkId: headerLinkId(),
      });
      form.setSendTime(date);
      return;
    }

    form.setSendTime(date);

    if (date) {
      const draftID = currentDraft ?? (await executeSaveDraft());
      if (!draftID) {
        toast.failure('Failed to schedule message', {
          subtext: 'Draft required',
        });
        return;
      }

      await emailClient.scheduleMessage(
        {
          draftID,
          send_time: date.toISOString(),
        },
        headerLinkId()
      );

      const threadID = saveDraftMutation.data?.draft.thread_db_id;
      if (threadID) {
        await emailClient.flagArchived(
          { id: threadID, value: true },
          headerLinkId()
        );
      }
    }
  };

  // Unschedule when all recipients are removed
  const totalRecipientCount = () => {
    const r = form.recipients();
    return r.to.length + r.cc.length + r.bcc.length;
  };
  createEffect(
    on(
      totalRecipientCount,
      (count) => {
        if (count === 0 && form.sendTime()) {
          handleSendTimeChange(null);
        }
      },
      { defer: true }
    )
  );

  // --- Reset / delete ---

  const resetState = () => {
    clearEmailBody(editor());
    setContent('');
    setCurrentDraftID(undefined);
    form.clear();
  };

  const deleteDraftAndReset = async () => {
    const draftId = currentDraftID();
    if (draftId) {
      await deleteDraftMutation.mutateAsync({
        draftId,
        linkId: headerLinkId(),
      });
    }
    resetState();
  };

  // --- Derived state ---

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
    const fromDraft = emailContext?.recipientOptions();
    return fromDraft ?? destinationOptions();
  };

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

  // --- Context value ---

  const ctxValue: ComposeContextValue = {
    // Form state (read)
    recipients: form.recipients,
    subject: form.subject,
    attachments: form.attachments.list,
    sendTime: form.sendTime,
    initialHtml,

    // Form state (write)
    setRecipients: (field, value) => {
      form.setRecipients(field, value);
      scheduleDraftSave();
    },
    setSubject: (value) => {
      form.setSubject(value);
      scheduleDraftSave();
    },
    onContentChange,
    onAddAttachments: handleAddAttachments,
    onRemoveAttachment: handleRemoveAttachment,

    // Editor
    captureEditor: setEditor,

    // Actions
    onSend: () => void onSubmit(),
    onDelete: () => void deleteDraftAndReset(),
    onSendTimeChange: handleSendTimeChange,

    // Status
    disabled: () => hasLinkError() || sendMutation.isPending,
    isSending: () => sendMutation.isPending,
    hasDraft: () => currentDraftID() != null,

    // Validation
    validationError: (type) => {
      const error = validationError();
      if (error?.type === type) return error;
      return undefined;
    },

    // Recipients
    recipientOptions: getRecipientOptions,
    focusRecipientsOnMount: !hasLinkError(),

    // Schedule send
    scheduleSendDisabled: () => totalRecipientCount() === 0,

    // Display
    fromAddress: () => link()?.email_address,
    hasPaidAccess,
  };

  return (
    <ComposeProvider value={ctxValue}>
      <Show when={!isMobile()}>
        <SplitHeaderLeft>
          <StaticSplitLabel
            class="ph-no-capture"
            label={ctxValue.subject() || previewName?.() || 'Draft email'}
            iconType="email"
            badges={[
              <SplitHeaderBadge text="draft" tooltip="This is a Draft Email" />,
            ]}
          />
        </SplitHeaderLeft>
      </Show>
      <div class="relative flex flex-col size-full min-h-0 overflow-hidden text-sm">
        <Show when={hasLinkError()}>
          <EmailPermissionsBanner />
        </Show>
        <div class="macro-message-width sm:macro-message-padding mx-auto w-full min-h-120 max-h-full my-2 sm:my-12 mobile:my-0 px-2 sm:px-4 mobile:px-0 overflow-hidden mobile:overflow-y-auto mobile:scrollbar-hidden mobile:min-h-full">
          <WrapUnlessMobile
            wrapper={(children) => (
              <Surface depth={2} class="rounded-xl border border-ink-muted/8">
                {children}
              </Surface>
            )}
          >
            <ComposeLayout
              toolbar={<EmailComposeToolbar editor={editor} />}
              class="size-full p-4 bg-surface max-h-full mobile:max-h-none overflow-hidden flex flex-col min-h-0 mobile:min-h-full"
            />
          </WrapUnlessMobile>
        </div>
      </div>
    </ComposeProvider>
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
