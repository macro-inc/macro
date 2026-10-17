import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { isPersonalMessage } from '@app/features/email-message/core/is-personal-message';
import { toEmailThread } from '@app/features/email-thread/queries/thread-source';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { WrapUnlessMobile } from '@core/mobile/WrapUnlessMobile';
import { useThreadQuery } from '@queries/email/thread';
import { ComposerSurface, Layer } from '@ui';
import type { LexicalEditor } from 'lexical';
import { createResource, createSignal, Show } from 'solid-js';
import { DraftSyncStatus } from './components/draft-sync-status';
import { EmailScheduleBar } from './components/email-schedule-summary';
import { SignaturePreview } from './components/signature-preview';
import { createEmailComposeContext } from './compose-adapter';
import { createEmailComposeHost } from './compose-host-adapter';
import type {
  EmailComposeContext,
  EmailComposeHost,
} from './context/compose-capabilities';
import { ComposeProvider } from './context/compose-context';
import { getOrInitEmailFormContext } from './context/email-form-context';
import type { EmailReplySession } from './context/email-form-inputs';
import { decodeBase64Utf8 } from './core/decode-base64';
import type { LocalDraft } from './core/local-draft';
import { plainTextToHtml } from './core/plain-text-to-html';
import type { ReplyType } from './core/reply-type';
import { displaySubject } from './core/subject-text';
import type { ComposeContextValue } from './primitives/compose-view-state';
import { createDraftSyncStatus } from './primitives/draft-sync-status';
import type { DraftFormAttachment } from './primitives/email-form-state';
import { createReplyComposer } from './primitives/reply-composer';
import { ComposeLayout } from './views/compose-layout';
import { EmailComposeToolbar } from './views/compose-toolbar';

export type FullscreenReplyComposeProps = {
  threadId: string;
  replyingToMessageId: string;
  replyType: ReplyType;
};

export function FullscreenReplyCompose(props: FullscreenReplyComposeProps) {
  const composeContext = createEmailComposeContext();
  const host = createEmailComposeHost();
  const threadQuery = useThreadQuery(
    () => props.threadId,
    () => ({
      enabled: !!props.threadId,
    })
  );

  const thread = () => {
    if (!threadQuery.isSuccess || !threadQuery.data?.thread) return undefined;
    return toEmailThread(threadQuery.data.thread);
  };

  const replyingTo = () => {
    const t = thread();
    if (!t) return undefined;
    return t.messages.find((m) => m.db_id === props.replyingToMessageId);
  };

  const draft = () => {
    const t = thread();
    if (!t) return undefined;
    return t.messages.find(
      (m) => m.is_draft && m.replying_to_id === props.replyingToMessageId
    );
  };

  return (
    <Show
      when={!threadQuery.isLoading}
      fallback={
        <div role="status" class="p-4">
          Loading thread…
        </div>
      }
    >
      <Show
        when={thread() && replyingTo()}
        fallback={
          <div role="alert" class="p-4">
            Unable to load the message to reply to.
          </div>
        }
      >
        <FullscreenReplyComposeView
          threadId={props.threadId}
          replyType={props.replyType}
          thread={thread()!}
          replyingTo={replyingTo()!}
          draft={draft()}
          context={composeContext}
          host={host}
        />
      </Show>
    </Show>
  );
}

type FullscreenReplyComposeViewProps = {
  threadId: string;
  replyType: ReplyType;
  thread: ReturnType<typeof toEmailThread>;
  replyingTo: EmailMessage;
  draft?: EmailMessage;
  context: EmailComposeContext;
  host?: EmailComposeHost;
};

function FullscreenReplyComposeView(props: FullscreenReplyComposeViewProps) {
  const composeContext = props.context;

  const initialDraftId = props.draft?.db_id;
  const readInitialDraft = composeContext.drafts.readDraft;

  const [saved, { refetch }] = createResource(
    () => readInitialDraft && initialDraftId,
    async (id) => await readInitialDraft!(id)
  );

  return (
    <Show
      when={!saved.loading}
      fallback={
        <div role="status" class="p-4">
          Loading draft…
        </div>
      }
    >
      <Show
        when={!saved.error}
        fallback={
          <div role="alert" class="p-4">
            Unable to load draft.{' '}
            <button onClick={() => void refetch()}>Retry</button>
          </div>
        }
      >
        <LoadedFullscreenReplyComposeView
          {...props}
          draft={saved()?.draft ?? props.draft}
          localDraft={saved()?.local}
          localAttachments={saved()?.attachments}
        />
      </Show>
    </Show>
  );
}

function LoadedFullscreenReplyComposeView(
  props: FullscreenReplyComposeViewProps & {
    localDraft?: LocalDraft;
    localAttachments?: DraftFormAttachment[];
  }
) {
  const composeContext = props.context;
  const [editor, setEditor] = createSignal<LexicalEditor>();
  let composeContainerRef: HTMLDivElement | undefined;
  let bottomBarRef: HTMLDivElement | undefined;

  const draftHTML = () => {
    const draft = props.draft;
    if (!draft) return '';
    const encoded = draft.body_html_sanitized;
    if (!encoded) {
      const plainText = draft.body_text;
      if (!plainText) return '';
      return plainTextToHtml(plainText);
    }
    return decodeBase64Utf8(encoded);
  };

  const replySession: EmailReplySession = {
    thread: () => ({
      db_id: props.thread.db_id,
      link_id: props.thread.link_id,
      inbox_visible: props.thread.inbox_visible,
      provider_id: props.thread.provider_id,
    }),
    recipientOptions: () => [],
    isPersonalReply: () => {
      const viewerEmail = composeContext.viewerEmail();
      if (!viewerEmail) return false;
      return isPersonalMessage(
        props.replyingTo,
        viewerEmail,
        new Set<string>()
      );
    },
    onDraftRemoved: () => {},
    replyRequest: {
      replyType: () => props.replyType,
      clear: () => {},
    },
    exitToThread: () => {
      props.host?.goBack?.();
      return true;
    },
  };

  const state = createReplyComposer(
    {
      drafts: composeContext.drafts,
      attachmentStorage: composeContext.attachmentStorage,
      delivery: composeContext.delivery,
      draftLifecycle: composeContext.draftLifecycle,
      notices: composeContext.notices,
      accounts: composeContext.accounts,
      connectivity: composeContext.connectivity,
      viewerEmail: composeContext.viewerEmail,
      hasPaidAccess: composeContext.hasPaidAccess,
      recordMention: composeContext.recordMention,
      focusAfterReplyRequest: () => !composeContext.presentation.isTouch(),
      session: replySession,
      sourceEntityId: props.threadId,
      replyingTo: () => props.replyingTo,
      draft: props.draft,
      localDraft: props.localDraft,
      localAttachments: props.localAttachments,
      preloadedHtml: draftHTML(),
      host: props.host,
      sideEffectOnSend: async () => {
        props.host?.showThread?.(props.threadId);
      },
    },
    editor,
    { container: () => composeContainerRef, footer: () => bottomBarRef },
    getOrInitEmailFormContext
  );

  const sync = createDraftSyncStatus({
    drafts: composeContext.drafts,
    draftId: state.savedDraftId,
    localSaveState: state.localSaveState,
    acknowledgeSaved: state.acknowledgeSaved,
    retry: state.retryDraft,
    discard: state.deleteDraftAndReset,
  });

  const {
    form,
    activeInboxEmail,
    setIncludeSignature,
    savedDraftId,
    hasPaidAccess,
    deleteDraftAndReset,
    scheduleState,
    scheduleOperation,
    handleSendTimeChange,
    cancelSchedule,
  } = state;

  const [draftBackMenuOpen, setDraftBackMenuOpen] = createSignal(false);
  const statusLabel = () =>
    scheduleState().type === 'scheduled' ? 'scheduled' : 'draft';
  const statusTooltip = () => {
    const schedule = scheduleState();
    if (schedule.type === 'scheduled')
      return `Scheduled for ${schedule.confirmedTime.toLocaleString()}. Use the send-time control to propose an update or cancel.`;
    return 'This is a draft email.';
  };

  const ctxValue: ComposeContextValue = {
    recipients: form.recipients,
    subject: form.subject,
    attachments: form.attachments.list,
    initialHtml: draftHTML,
    setRecipients: (field, value) => {
      form.setRecipients(field, value);
      state.scheduleDraftSave();
    },
    setSubject: (value) => {
      form.setSubject(value);
      state.scheduleDraftSave();
    },
    onContentChange: state.onContentChange,
    onAddAttachments: (attachments) => {
      const files = attachments
        .filter((a): a is { type: 'local'; file: File } => a.type === 'local')
        .map((a) => a.file);
      if (files.length > 0) {
        void state.handleAddAttachments(files);
      }
    },
    onRemoveAttachment: state.handleRemoveAttachment,
    captureEditor: setEditor,
    onSend: () => void state.sendEmail(),
    onDelete: () => void deleteDraftAndReset(),
    schedule: {
      state: scheduleState,
      selectedTime: state.selectedSendTime,
      confirmedTime: () => {
        const schedule = scheduleState();
        return schedule.type === 'scheduled'
          ? schedule.confirmedTime
          : undefined;
      },
      actionLabel: state.scheduleActionLabel,
      operation: scheduleOperation,
      onSelect: handleSendTimeChange,
      onCancel: cancelSchedule,
      pickerDisabled: () => state.editingDisabled() || state.isSending(),
    },
    disabled: state.editingDisabled,
    primaryActionDisabled: state.sendActionDisabled,
    isSending: state.isSending,
    hasDraft: () => savedDraftId() != null,
    deliveryState: () =>
      scheduleState().type === 'scheduled' ? 'scheduled' : 'draft',
    sendUnavailableReason: state.sendUnavailableReason,
    validationError: () => undefined,
    recipientOptions: () => composeContext.recipients() ?? [],
    focusRecipientsOnMount: false,
    fromAddress: activeInboxEmail,
    fromInboxes: () => composeContext.accounts.inboxes() ?? [],
    selectedInboxId: state.activeInboxId,
    onSelectInbox: state.persistDraftOnSenderSwitch,
    hasPaidAccess,
    bodyActions: {
      focusSibling: props.host?.focusSibling,
      recipientAdded: (email) =>
        composeContext.notices.feedback.success(`${email} added to CC`),
      readDroppedFiles: composeContext.editorFiles.readDroppedFiles,
      insertFiles: (editorInstance, input) =>
        composeContext.editorFiles.uploadEditorFiles({
          editor: editorInstance,
          ...input,
          onUploaded: (ids) =>
            ids.forEach(composeContext.editorFiles.makePublic),
        }),
    },
    isMobile: composeContext.presentation.isMobile,
    scheduleEnabled: composeContext.presentation.scheduleEnabled,
    attachmentFailure: composeContext.notices.feedback.failure,
    onUpgrade: composeContext.presentation.onUpgrade,
    viewerLoading: composeContext.presentation.viewerLoading,
    signaturePreview: () => {
      const html = state.signatureHtml?.();
      if (!composeContext.presentation.signaturesEnabled() || !html)
        return null;
      return (
        <SignaturePreview
          mobile={composeContext.presentation.isMobile()}
          prepareLinks={composeContext.presentation.prepareSignatureLinks}
          html={html}
          dismissable={!state.editingDisabled()}
          onDismiss={() => setIncludeSignature(false)}
        />
      );
    },
  };

  if (composeContext.presentation.isMobile()) {
    props.host?.registerBack?.(() => {
      if (!ctxValue.hasDraft()) return false;
      setDraftBackMenuOpen(true);
      return true;
    });
  }

  const leaveCompose = async () => {
    try {
      await state.flushLocal?.();
    } catch (error) {
      composeContext.notices.reportError(error);
      return;
    }
    setDraftBackMenuOpen(false);
    props.host?.goBack?.();
  };

  const SyncStatus = () => (
    <DraftSyncStatus
      state={sync.state()}
      busy={sync.busy()}
      error={sync.error()}
      onRetry={sync.retry}
      onKeepEditing={sync.keepEditing}
    />
  );

  const title = () =>
    form.subject() || displaySubject(props.replyingTo.subject) || 'Reply';

  return (
    <ComposeProvider value={ctxValue}>
      <Show when={!composeContext.presentation.isMobile()}>
        <SplitHeaderLeft>
          <StaticSplitLabel
            class="ph-no-capture"
            label={title()}
            iconType="email"
            badges={[
              <SplitHeaderBadge
                text={statusLabel()}
                tooltip={statusTooltip()}
              />,
            ]}
          />
        </SplitHeaderLeft>
      </Show>
      <div
        ref={(el) => (composeContainerRef = el)}
        class="relative flex flex-col size-full min-h-0 overflow-hidden text-sm"
      >
        <div class="macro-message-width sm:macro-message-padding mx-auto w-full min-h-120 max-h-full my-2 sm:my-12 touch:my-0 px-2 sm:px-4 touch:px-0 touch:overflow-y-auto touch:scrollbar-hidden touch:min-h-full">
          <WrapUnlessMobile
            wrapper={(children) => (
              <div class="flex size-full min-h-0 flex-col">
                <ComposerSurface
                  as="div"
                  class="relative z-10 min-h-0 flex-1 overflow-clip touch:rounded-xl touch:border touch:border-edge-muted"
                >
                  {children}
                </ComposerSurface>
                <EmailScheduleBar
                  state={scheduleState()}
                  operation={scheduleOperation()}
                  onSelectTime={handleSendTimeChange}
                  onCancelSchedule={cancelSchedule}
                  class="-mt-6 rounded-b-[20px] border border-t-0 border-edge-muted px-4 pt-8 pb-2"
                />
              </div>
            )}
          >
            <Layer depth={2}>
              <ComposeLayout
                toolbar={
                  <EmailComposeToolbar
                    editor={editor}
                    status={<SyncStatus />}
                  />
                }
                class="size-full p-4 touch:bg-surface max-h-full touch:max-h-none overflow-hidden flex flex-col min-h-0 touch:min-h-full"
              />
            </Layer>
          </WrapUnlessMobile>
        </div>
      </div>
      <Show when={composeContext.presentation.isMobile()}>
        <MobileDrawer
          side="bottom"
          open={draftBackMenuOpen()}
          onOpenChange={setDraftBackMenuOpen}
          preventScroll={false}
          preventScrollbarShift={false}
        >
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay />
            <MobileDrawer.Content aria-label="Draft options">
              <MobileDrawer.Handle />
              <MobileDrawer.Section class="mb-3">
                <button
                  type="button"
                  class="w-full bg-surface px-3 py-3.5 text-sm font-medium text-failure text-center not-last:mb-px"
                  onClick={async () => {
                    try {
                      await deleteDraftAndReset();
                    } catch {
                      setDraftBackMenuOpen(false);
                      return;
                    }
                    setDraftBackMenuOpen(false);
                  }}
                >
                  Delete Draft
                </button>
                <button
                  type="button"
                  class="w-full bg-surface px-3 py-3.5 text-sm font-medium text-center"
                  onClick={leaveCompose}
                >
                  Save Draft
                </button>
              </MobileDrawer.Section>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </Show>
    </ComposeProvider>
  );
}
