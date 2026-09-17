import {
  MACRO_EMAIL_SIGNATURE,
  MAX_ATTACHMENTS_BYTES_SIZE,
} from '@app/features/email-compose/core/constants';
import type { EmailMessage } from '@app/features/email-message/core/email-message';
import type { UserMentionRecord } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { setEditorStateFromHtml } from '@core/component/LexicalMarkdown/utils/setEditorStateFromHtml';
import { deviceLooksOffline } from '@core/util/connectivity';
import { plural } from '@core/util/string';
import { $generateHtmlFromNodes } from '@lexical/html';
import {
  $appendWatermarkNodeToLast,
  $removeAllWatermarkNodes,
} from '@macro-inc/lexical-core';
import type { LexicalEditor } from 'lexical';
import { $addUpdateTag, $getRoot } from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type Setter,
  untrack,
} from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import {
  DraftPersistRejected,
  type EmailAttachmentStorage,
  type EmailComposeAccounts,
  type EmailComposeFeedback,
  type EmailDelivery,
  type EmailDraftStorage,
  type EmailUndoHandle,
} from '../context/compose-capabilities';
import type { EmailReplySession } from '../context/email-form-inputs';
import type { EmailDraft } from '../core/email-draft';
import {
  convertContactInfoToEmailRecipient,
  convertEmailRecipientToContactInfo,
} from '../core/recipient-conversion';
import { createAttachmentPersistence } from './attachment-persistence';
import { createDraftAutosave } from './draft-autosave';
import { createDraftSession } from './draft-session';
import type { DraftFormAttachment } from './email-form-state';
import type { EmailFormContextValue, FormAccessKey } from './email-form-types';
import { createEmailSendSchedule } from './email-send-schedule';
import { addUserMentionToCc } from './mention-to-cc';
import {
  clearEmailBody,
  hasDraftContent,
  prepareEmailBody,
  prepareMacroBody,
  TOGGLE_APPEND_EMAIL_THREAD_COMMAND,
} from './prepare-email-body';
import { createReplyComposerFocus } from './reply-composer-focus';
import { createReplyRecipientFields } from './reply-recipient-fields';
import { endUndoSend } from './undo-send-claim';
import { createEmailUndoStore } from './undo-store';

type UndoReplySnapshot = {
  threadId: string;
  inboxId: string | undefined;
  draftId: string;
  bodyHtml: string;
  attachments: DraftFormAttachment[];
  includeSignature: boolean;
  /** Whether the quoted thread was appended in the editor at send time.
   * Restored so the quoted-text toggle matches the restored body — otherwise
   * it reads as "not appended" and appends a duplicate quote block. */
  replyAppended: boolean;
  /** Draft payload for restoring the server-side draft on undo. The
   * unscheduled message keeps the sent body (appended reply chain, injected
   * signature), so undo re-saves the draft with the pre-send content —
   * bodyHtml above, prepared at undo time, fills body_html. */
  draftRestore: EmailDraft;
};
const replyUndo = createEmailUndoStore<UndoReplySnapshot>();

export type ReplyComposerOptions = {
  drafts: EmailDraftStorage;
  attachmentStorage: EmailAttachmentStorage;
  delivery: EmailDelivery;
  notices: EmailComposeFeedback;
  accounts: EmailComposeAccounts;
  viewerEmail: Accessor<string | undefined>;
  hasPaidAccess: Accessor<boolean>;
  recordMention(sourceId: string, targetId: string): void;
  focusAfterReplyRequest: Accessor<boolean>;
  session: EmailReplySession;
  sourceEntityId: string;
  replyingTo: Accessor<EmailMessage | undefined>;
  isEditingExisting?: boolean;
  draft?: EmailMessage;
  preloadedHtml?: string;
  /** Seed identity of the draft this composer mounted from — becomes part of
   * the form-state cache key so a remount on a newer draft version gets a
   * freshly seeded form. See ThreadReplyInput's seed key. */
  formSeed?: string;
  /** Reports the composer gaining local state worth keeping — a first edit
   * or save (every modification funnels through scheduleDraftSave) or an
   * undo-send restore. The parent latches the seed key on it so the input
   * stops remounting on later draft versions. */
  onEngaged?: () => void;
  sideEffectOnSend?: (newMessageId: string | null) => void | Promise<void>;
  onMarkDone?: (opts?: {
    silent?: boolean;
    onUndoHandle?: (handle: EmailUndoHandle) => void;
    nextEntityId?: string;
  }) => void;
  setShowReply?: Setter<boolean>;
};

export function createReplyComposer(
  props: ReplyComposerOptions,
  editor: Accessor<LexicalEditor | undefined>,
  dom: {
    container: Accessor<HTMLDivElement | undefined>;
    footer: Accessor<HTMLDivElement | undefined>;
  },
  forms: (key?: FormAccessKey) => EmailFormContextValue
) {
  const ctx = props.session;
  // Each keyed composer owns a target and draft version. Parent props can already
  // point at the next target when Solid disposes this editor and flushes its save.
  const replyTarget = props.replyingTo();
  const draftSeed = props.draft;
  const initialThread = ctx.thread();
  const thread = () => {
    const current = ctx.thread();
    return current?.db_id === initialThread?.db_id ? current : initialThread;
  };
  const form = forms(
    replyTarget?.db_id
      ? {
          type: 'replying_to',
          messageId: replyTarget.db_id,
          seed: props.formSeed,
        }
      : draftSeed?.db_id
        ? {
            type: 'draft',
            messageId: draftSeed.db_id,
            seed: props.formSeed,
          }
        : undefined
  );
  const sourceEntityId = props.sourceEntityId;
  const undoKey = `${sourceEntityId}:${replyTarget?.db_id ?? draftSeed?.replying_to_id ?? draftSeed?.db_id ?? 'new'}`;
  const userEmail = props.viewerEmail;

  const primaryInboxId = props.accounts.primaryId;
  // Capture this domain inbox ID for each asynchronous operation.
  const activeInboxId = () =>
    form.selectedInboxId() ??
    thread()?.link_id ??
    draftSeed?.link_id ??
    primaryInboxId() ??
    props.accounts.inboxes()[0]?.id;
  // The address of the inbox this input sends from, for the "from" display.
  const activeInboxEmail = () =>
    props.accounts.inboxes().find((l) => l.id === activeInboxId())
      ?.email_address ?? userEmail();

  // The full Link object for the sending inbox (for its saved signature and the
  // "add to replies & forwards" preference).
  const sendingInbox = createMemo(() =>
    props.accounts.inboxes().find((l) => l.id === activeInboxId())
  );
  const signature = () => sendingInbox()?.settings.signature ?? undefined;
  // Whether this reply includes the signature. Defaults on, reset per reply,
  // and dismissable via the preview ✕.
  const [includeSignature, setIncludeSignature] = createSignal(true);
  // Signature HTML for the preview (and whether to show it): only for
  // replies/forwards, when the inbox's "add to replies & forwards" setting is on
  // and the user hasn't dismissed it. The backend does the actual injection on
  // send — this just mirrors when that will happen.
  const replySignatureHtml = (): string | undefined =>
    replyTarget &&
    includeSignature() &&
    sendingInbox()?.settings.signature_on_replies_forwards
      ? signature()
      : undefined;

  const [bodyMacro, setBodyMacro] = createSignal<string>('');
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();
  // Gmail-style sizing: the composer opens compact and grows to the full cap
  // once the user scrolls the content
  const [composerExpanded, setComposerExpanded] = createSignal(false);
  // Appended quoted thread starts hidden behind a "⋯" pill (desktop). A
  // draft reloaded with the quote already appended opens expanded instead —
  // that's how the composer looked when the draft was saved.
  const [quoteCollapsed, setQuoteCollapsed] = createSignal(
    !form.replyAppended()
  );
  const recipients = createReplyRecipientFields({
    values: form.recipients,
    setValues: form.setRecipients,
    onChange: scheduleDraftSave,
    container: dom.container,
    disabled: () => submitting() || pendingDeletion() || scheduling(),
  });
  const focus = createReplyComposerFocus({
    editor,
    container: dom.container,
    footer: dom.footer,
    scrollContainer,
    toInput: recipients.toRef,
    expandRecipients: () => recipients.setShowExpandedRecipients(true),
  });
  // A pending undo-send restore that belongs to this thread (inline reply
  // remount case). It carries a just-undone send. Consumed below.
  const restoredSnapshot = replyUndo.takePending(undoKey);

  // Switching inboxes can move a draft out of the displayed thread. The
  // session keeps the draft's persisted identity together for subsequent
  // saves, discard, schedule and undo — and whether the server has confirmed
  // it, which the REST-only send and schedule depend on.
  const session = createDraftSession(
    restoredSnapshot
      ? {
          draftId: restoredSnapshot.draftId,
          threadId: restoredSnapshot.threadId,
        }
      : draftSeed?.db_id
        ? { draftId: draftSeed.db_id, threadId: draftSeed.thread_db_id }
        : undefined
  );
  const savedDraftId = session.draftId;
  const savedDraftThreadId = session.threadId;

  // Consume the undo-send snapshot so a later composer mount doesn't restore
  // it again. Use bodyHtml as initialHtml for the editor, restore attachments
  // on mount.
  const restoreEnvelope = (snapshot: UndoReplySnapshot) => {
    form.setSelectedInbox(snapshot.inboxId);
    form.setSubject(snapshot.draftRestore.subject);
    for (const field of ['to', 'cc', 'bcc'] as const) {
      form.setRecipients(
        field,
        (snapshot.draftRestore[field] ?? []).map(
          convertContactInfoToEmailRecipient
        )
      );
    }
  };
  if (restoredSnapshot) {
    restoreEnvelope(restoredSnapshot);
    onMount(() => {
      // Restored content is local state worth keeping — latch the seed.
      props.onEngaged?.();
      for (const attachment of restoredSnapshot.attachments) {
        form.attachments.add(attachment);
      }
      setIncludeSignature(restoredSnapshot.includeSignature);
      form.setReplyAppended(restoredSnapshot.replyAppended);
      // Reopen with the quote visible, as it was when the send was undone.
      if (restoredSnapshot.replyAppended) setQuoteCollapsed(false);
    });
  }

  // Register a callback so stale undoSend closures from a previous mount can
  // restore state into this (the live) component instance.
  const restoreMountedReply = (snapshot: UndoReplySnapshot) => {
    const draftId = snapshot.draftId;
    props.onEngaged?.();
    session.dispatch({ type: 'seeded', draftId, threadId: snapshot.threadId });
    restoreEnvelope(snapshot);
    const currentEditor = editor();
    if (currentEditor && snapshot.bodyHtml) {
      setEditorStateFromHtml(currentEditor, snapshot.bodyHtml);
    }
    for (const attachment of snapshot.attachments) {
      form.attachments.add(attachment);
    }
    setIncludeSignature(snapshot.includeSignature);
    form.setReplyAppended(snapshot.replyAppended);
    // Reopen with the quote visible, as it was when the send was undone.
    if (snapshot.replyAppended) setQuoteCollapsed(false);
  };
  let mounted = true;
  const unregisterUndo = replyUndo.register(undoKey, restoreMountedReply);
  onCleanup(() => {
    mounted = false;
    unregisterUndo();
  });

  const initialHtml = () => restoredSnapshot?.bodyHtml ?? props.preloadedHtml;
  const [editorConnected, setEditorConnected] = createSignal(false);
  const handleEditorConnect = () => {
    const currentEditor = editor();
    if (!currentEditor) return;
    const html = initialHtml();
    if (html) {
      // Restore content without letting selection reconciliation grab focus
      currentEditor.update(() => {
        $addUpdateTag('skip-dom-selection');
        setEditorStateFromHtml(currentEditor, html, true);
      });
    }
    setEditorConnected(true);
  };

  // Everything that follows a successful unschedule: consume the send
  // snapshot, scrub the sent message from the thread cache, restore the
  // server-side draft and the composer.
  const restoreAfterUndoSend = async (
    draftId: string,
    sentThreadId: string | undefined,
    inboxId: string | undefined
  ) => {
    const snapshot = replyUndo.take(draftId);

    // Reconcile the actual message thread, which can differ from the host when
    // replying from another inbox. The host's undoKey still owns local recovery.
    const threadId = sentThreadId ?? snapshot?.threadId;
    await props.drafts.restoreDraft({
      draftId,
      threadId,
      draft: snapshot?.draftRestore,
      html: snapshot?.bodyHtml,
      inboxId,
    });

    if (snapshot) {
      // Resolve the live registration after cache updates and unmounts settle.
      setTimeout(() => replyUndo.restore(undoKey, snapshot), 0);
      props.setShowReply?.(true);
    }
  };

  const attachmentPersistence = createAttachmentPersistence({
    services: props.attachmentStorage,
    attachments: form.attachments,
    draftId: savedDraftId,
    inboxId: activeInboxId,
  });

  createEffect(
    on(form.editRevision, () => scheduleDraftSave(), { defer: true })
  );

  // The mounted composer owns focus, editor commands, and their cleanup.
  createEffect(() => {
    const rt = form.replyType();
    if (!editorConnected()) return;
    untrack(() => {
      setComposerExpanded(false);
      if (rt === 'forward') {
        setQuoteCollapsed(true);
        focus.forward();
        const message = replyTarget;
        const currentEditor = editor();
        if (message && currentEditor && form.replyAppended()) {
          // The editor's lazy command registration completes after this batch.
          const timer = setTimeout(
            () =>
              currentEditor.dispatchCommand(
                TOGGLE_APPEND_EMAIL_THREAD_COMMAND,
                {
                  replyingTo: message,
                  replyType: rt,
                  visible: true,
                  isPersonal: ctx.isPersonalReply(),
                }
              ),
            0
          );
          onCleanup(() => clearTimeout(timer));
        }
      } else {
        focus.reply();
      }
    });
  });

  const [sendPhase, setSendPhase] = createSignal<
    'idle' | 'preparing' | 'sending'
  >('idle');
  const submitting = () => sendPhase() !== 'idle';
  const sending = () => sendPhase() === 'sending';
  const [pendingDeletion, setPendingDeletion] = createSignal(false);

  function collectDraft() {
    $removeAllWatermarkNodes(editor());
    const prepared = prepareEmailBody(editor());
    if (!prepared) {
      props.notices.reportError(
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
      provider_id: draftSeed?.provider_id,
      replying_to_id: replyTarget?.db_id,
      subject: form.subject(),
      to: form.recipients().to.map(convertEmailRecipientToContactInfo),
    };
  }

  const captureSave = (completingThread = false) => ({
    draft: collectDraft(),
    thread: thread(),
    inboxId: activeInboxId(),
    completingThread,
  });
  // The server rejected this draft as already sent from another device: its
  // outcome supersedes the local draft. Drop content and identity — so no
  // later save or send targets the sent message — and show the thread's
  // real state. The session's epoch bump makes in-flight continuations
  // stale; the deletion flag blocks the save that resetting schedules and is
  // restored on a timeout for the stay-mounted case, as in deleteDraftAndReset.
  const handleAlreadySent = () => {
    props.notices.feedback.alert('This reply was already sent');
    setPendingDeletion(true);
    autosave.cancel();
    try {
      resetState();
      clearDraftState();
    } finally {
      setTimeout(() => {
        autosave.cancel();
        setPendingDeletion(false);
      }, 0);
    }
  };
  // A deterministic rejection is the session's to record (latch autosave,
  // or drop the draft on already-sent); transport failures just reject and
  // the next save may retry them.
  const recordRejection = (error: unknown, epoch: number) => {
    if (!(error instanceof DraftPersistRejected) || session.isStale(epoch))
      return;
    session.dispatch({ type: 'rejected', epoch, code: error.code });
    if (error.code === 'DRAFT_ALREADY_SENT') handleAlreadySent();
  };

  async function persistDraft({
    draft: draftToSave,
    thread: currentThread,
    inboxId,
    completingThread,
  }: ReturnType<typeof captureSave>) {
    if (!draftToSave) {
      const draftId = savedDraftId();
      const epoch = session.epoch();
      if (draftId) {
        try {
          await props.drafts.deleteDraft({
            draftId,
            threadId: savedDraftThreadId(),
            inboxId,
            completingThread,
          });
        } catch (error) {
          recordRejection(error, epoch);
          throw error;
        }
      }
      if (session.isStale(epoch)) return;
      session.dispatch({ type: 'emptied' });
      return;
    }
    if (!currentThread) {
      props.notices.reportError(
        new Error('Failed to save draft: thread not found')
      );
      return;
    }
    // Latched after a deterministic rejection: the content stays in the
    // editor, but the same save must never be replayed on its own. Checked
    // after the empty branch so clearing the draft still runs, and lifts it.
    if (!session.autosaveAllowed()) return;

    // Identity is local-first: a handle minted before the first dispatch, so
    // every queued save for this draft resolves to one server row — even when
    // the responses arrive after an app restart. The server maps the handle
    // to a server-minted row; a committed save's ids are adopted below.
    // Minted v7 (best effort, never trusted) to keep the mapping index friendly.
    const previousThreadId = savedDraftThreadId();
    if (!session.draftId()) {
      session.dispatch({
        type: 'minted',
        draftId: uuidv7(),
        threadId: currentThread.db_id,
      });
    }
    const identity = session.identity();
    const epoch = session.epoch();
    let draftResponse;
    try {
      draftResponse = await props.drafts.saveDraft({
        draft: {
          ...draftToSave,
          // Only a server-confirmed id travels as db_id; a minted handle
          // goes apart, since a REST save cannot resolve it.
          db_id: identity.kind === 'server' ? identity.draftId : undefined,
          provider_thread_id: currentThread.provider_id,
          thread_db_id: currentThread.db_id,
        },
        clientHandles:
          identity.kind === 'handle'
            ? { draftId: identity.draftId, threadId: identity.threadId }
            : undefined,
        inboxId,
        completingThread,
        previousThreadId,
      });
    } catch (error) {
      recordRejection(error, epoch);
      throw error;
    }
    // Reset while the save was on the wire (a send, a discard, another
    // save's already-sent outcome): the answer belongs to a draft the user
    // already dropped. Adopting its ids, uploading — the upload reads the
    // live form, which may already hold the next draft's files — or
    // refetching would re-plant that draft into the fresh composer.
    if (session.isStale(epoch)) return;
    session.dispatch({ type: 'saved', epoch, identity: draftResponse });
    const draftId = draftResponse.draftId;
    if (!draftId) return;

    if (draftResponse.persistence === 'queued') {
      // Durably queued under client handles. Local attachments are not on
      // the durable queue yet (a later change moves them there), so they
      // upload over REST right away — offline, or against a handle the
      // server has not seen, that fails out the way an offline attachment
      // does today: the upload's own notice, file kept for the next save.
      // The miss is not the save's failure, and forwarded attachments wait
      // for a committed save.
      await attachmentPersistence
        .upload(draftId, { inboxId })
        .catch(() => undefined);
      return draftId;
    }
    await attachmentPersistence.upload(draftId, { inboxId });
    if (session.isStale(epoch)) return;

    const forwarded = form.attachments
      .list()
      .filter((attachment) => attachment.type === 'forwarded');
    if (forwarded.length) {
      await props.attachmentStorage.addForwardedAttachments({
        draftId: draftId,
        attachments: forwarded.map((a) => ({
          attachmentId: a.attachmentId,
        })),
        inboxId,
      });
    }

    return draftId;
  }

  const autosave = createDraftAutosave({
    capture: captureSave,
    persist: persistDraft,
    paused: () => submitting() || pendingDeletion(),
  });
  function executeSaveDraft(completingThread = false) {
    return autosave.save(captureSave(completingThread));
  }
  function scheduleDraftSave() {
    if (submitting() || pendingDeletion()) return;
    props.onEngaged?.();
    autosave.schedule();
  }

  // Persist the draft immediately when the user switches the sending inbox, even
  // without a text edit, so it moves to the new inbox and the choice survives a
  // refresh. Driven by the explicit switch (below) rather than inbox reactivity.
  const persistDraftOnSenderSwitch = (inboxId: string) => {
    if (submitting() || pendingDeletion() || scheduling()) return;
    props.onEngaged?.();
    form.setSelectedInbox(inboxId);
    autosave.cancel();
    void executeSaveDraft().catch(() => {});
  };

  createEffect(() => {
    const requestReplyType = ctx.replyRequest.replyType();

    if (!requestReplyType) return;

    if (form.replyType() !== requestReplyType) {
      form.setReplyType(requestReplyType);
    } else if (requestReplyType === 'forward') {
      // setReplyType is skipped when the type is unchanged, so land the
      // cursor in the To field explicitly
      focus.forward();
    }
    // Forwards focus the To field; focusing the editor would steal it back
    if (requestReplyType !== 'forward') {
      if (props.focusAfterReplyRequest()) focus.editor(() => {});
    }
    ctx.replyRequest.clear();
  });

  // We are consuming the first change, because it is the initial value
  let firstChangeConsumed = false;
  const handleChange = (value: string) => {
    setBodyMacro(value);
    if (!firstChangeConsumed) {
      firstChangeConsumed = true;
      return;
    }
    untrack(scheduleDraftSave);
  };

  const hasPaidAccess = props.hasPaidAccess;

  const sendEmail = async (markDone = false) => {
    if (scheduling()) return;
    if (submitting() || pendingDeletion() || attachmentPersistence.uploading())
      return;

    const to = form.recipients().to.map(convertEmailRecipientToContactInfo);
    const cc = form.recipients().cc.map(convertEmailRecipientToContactInfo);
    const bcc = form.recipients().bcc.map(convertEmailRecipientToContactInfo);

    if ((to?.length ?? 0) + (cc?.length ?? 0) + (bcc?.length ?? 0) === 0) {
      props.notices.feedback.failure(
        'Email failed to send. No recipients provided'
      );
      return;
    }

    const currentThread = thread();
    if (!currentThread) {
      props.notices.reportError(
        new Error("Can't send email, no email thread found")
      );
      props.notices.feedback.failure('Email failed to send');
      return;
    }

    let inboxId = activeInboxId();
    if (!inboxId) {
      if (props.accounts.loading()) {
        props.notices.feedback.alert('Loading email accounts...');
        return;
      }

      if (props.accounts.failed()) {
        props.notices.feedback.failure(
          'Email failed to send: Could not load email accounts'
        );
        props.notices.reportError('Failed to load email links');
        return;
      }

      const inboxes = props.accounts.inboxes();
      if (inboxes.length < 1) {
        props.notices.feedback.failure(
          'Email failed to send: No email account connected'
        );
        props.notices.reportError('No links found');
        return;
      }
      inboxId = primaryInboxId() ?? inboxes[0].id;
    }

    const currentEditor = editor();

    // Sending a reply marks the thread done. Gated on inbox_visible because
    // onMarkDone (archiveThread) toggles: an already-archived thread (e.g.
    // replying from search or the sent view) would be unarchived.
    const willMarkDone = markDone || currentThread.inbox_visible;
    const nextEntityId = willMarkDone
      ? ctx.getMarkDoneNavigationTargetId()
      : undefined;

    // Sending is a REST call that resolves server ids only and is never
    // queued (email send moves onto the durable queue in a later change).
    // Offline, the pre-send save below can only queue, leaving a handle the
    // send cannot resolve — refuse outright, with a clear reason.
    if (deviceLooksOffline()) {
      props.notices.feedback.failure('Failed to send email', {
        subtext: "You're offline",
      });
      return;
    }

    setSendPhase('preparing');
    try {
      // Ensure draft is saved before sending so undo-send always has a draft to restore
      autosave.cancel();
      const epochBeforeSave = session.epoch();
      try {
        await executeSaveDraft(willMarkDone);
      } catch (error) {
        // The save (or its attachment upload) has already reported itself;
        // a draft the server may not have must not be sent.
        props.notices.reportError(error);
        props.notices.feedback.failure('Failed to send email', {
          subtext: 'Draft not saved',
        });
        return;
      }
      // The save can learn the reply was already sent from another device
      // and reset the composer; the recipients captured above would
      // otherwise go out on an empty message.
      if (session.isStale(epochBeforeSave)) return;
      // A queued pre-send save left client handles the REST send cannot
      // resolve (offline detection missed, or a first save still holds the
      // queue head). Ask for a retry while the content is still here.
      if (session.identity().kind === 'handle') {
        props.notices.feedback.failure('Failed to send email', {
          subtext: 'Draft still syncing, try again',
        });
        return;
      }
      // A local attachment still without a record did not upload, and the
      // upload has already reported it. Sending now would silently drop it.
      if (
        form.attachments
          .list()
          .some((a) => a.type === 'local' && !a.attachmentId)
      ) {
        props.notices.feedback.failure('Failed to send email', {
          subtext: 'Attachment not uploaded',
        });
        return;
      }

      // Snapshot editor state before watermark so undo-send can restore it.
      // Remember by draft so sends in separate composers cannot replace each other.
      if (currentEditor) {
        const snapshotHtml = currentEditor.read(() =>
          $generateHtmlFromNodes(currentEditor)
        );
        const snapshotDraftId = savedDraftId();
        const snapshotThreadId = savedDraftThreadId();
        if (snapshotDraftId && snapshotThreadId) {
          replyUndo.remember({
            threadId: snapshotThreadId,
            inboxId,
            draftId: snapshotDraftId,
            bodyHtml: snapshotHtml,
            attachments: [...form.attachments.list()],
            includeSignature: includeSignature(),
            replyAppended: form.replyAppended(),
            draftRestore: {
              bcc,
              cc,
              db_id: snapshotDraftId,
              provider_id: draftSeed?.provider_id,
              provider_thread_id: currentThread.provider_id,
              replying_to_id: replyTarget?.db_id,
              subject: form.subject(),
              thread_db_id: snapshotThreadId,
              to,
            },
          });
        }
      }

      // Scheduling may have started while the draft save was pending.
      if (scheduling() || form.sendTime()) {
        return;
      }

      // Append watermark after all validation passes so failed sends don't
      // leave orphaned watermark nodes in the editor tree.
      const cleanupWatermark = $appendWatermarkNodeToLast(
        currentEditor,
        !hasPaidAccess() ? MACRO_EMAIL_SIGNATURE : undefined
      );

      const replyingTo = replyTarget;

      const prepared = prepareEmailBody(
        currentEditor,
        replyingTo
          ? {
              replyType: form.replyType(),
              replyingTo,
            }
          : undefined
      );
      if (!prepared) {
        cleanupWatermark();
        return;
      }

      const processedMacroBody = prepareMacroBody(bodyMacro());

      const currentDraftId = savedDraftId();

      setSendPhase('sending');
      const pendingSend = props.delivery.sendMessage({
        message: {
          db_id: currentDraftId,
          bcc,
          body_html: prepared.bodyHtml,
          body_macro: processedMacroBody,
          body_text: prepared.bodyText,
          cc,
          provider_id: draftSeed?.provider_id,
          provider_thread_id: currentThread.provider_id,
          replying_to_id: replyTarget?.db_id,
          subject: form.subject(),
          thread_db_id: currentThread.db_id,
          to,
          // Replies/forwards follow the inbox's "add to replies & forwards"
          // setting on the backend; only signal an explicit per-reply dismiss.
          include_signature: includeSignature() ? undefined : false,
        },
        inboxId,
        completingThread: willMarkDone,
      });

      // Reset immediately while this task owns completion, including after unmount.
      try {
        resetState();
        clearDraftState();
      } catch (error) {
        props.notices.reportError(error);
      } finally {
        cleanupWatermark();
      }
      let result;
      try {
        result = await pendingSend;
      } catch (error) {
        autosave.cancel();
        if (mounted && currentDraftId) {
          const snapshot = replyUndo.peek(currentDraftId);
          if (snapshot) restoreMountedReply(snapshot);
        }
        props.notices.reportError(error);
        props.notices.feedback.failure('Failed to send email');
        return;
      }
      autosave.cancel();
      const draftId = result.draftId;
      if (draftId) endUndoSend(draftId);
      // Each undo action retains this send's inbox, thread and mark-done, even
      // if the composer sends again or navigation disposes the view.
      let markDoneUndoHandle: EmailUndoHandle | undefined;
      const undoSend = (draftId: string) =>
        props.delivery.undoSend({
          threadId: result.threadId,
          draftId,
          inboxId,
          onUndone: async () => {
            await restoreAfterUndoSend(draftId, result.threadId, inboxId);
            const doneHandle = markDoneUndoHandle;
            markDoneUndoHandle = undefined;
            await doneHandle?.undo({
              onError: () =>
                props.notices.feedback.failure(
                  'Failed to restore thread to inbox'
                ),
            });
          },
        });
      try {
        const toastId = props.notices.feedback.success('Email sent', {
          actions: draftId
            ? [
                {
                  label: 'Undo',
                  onClick: () => {
                    if (toastId != null)
                      props.notices.feedback.dismiss(toastId);
                    void undoSend(draftId).catch(props.notices.reportError);
                  },
                },
              ]
            : undefined,
          duration: 5_000,
        });
      } catch (error) {
        props.notices.reportError(error);
      }
      for (const mention of prepared.mentions) {
        try {
          props.recordMention(sourceEntityId, mention.documentId);
        } catch (error) {
          props.notices.reportError(error);
        }
      }
      if (willMarkDone) {
        try {
          props.onMarkDone?.({
            silent: true,
            onUndoHandle: (handle) => {
              markDoneUndoHandle = handle;
            },
            nextEntityId,
          });
        } catch (error) {
          props.notices.reportError(error);
          props.notices.feedback.failure(
            'Email sent, but unable to mark thread done'
          );
        }
      }
      try {
        // Presentation refresh must not keep a successfully sent or undone reply disabled.
        void Promise.resolve(props.sideEffectOnSend?.(draftId ?? null)).catch(
          props.notices.reportError
        );
      } catch (error) {
        props.notices.reportError(error);
      }
    } catch (error) {
      props.notices.reportError(error);
    } finally {
      setSendPhase('idle');
    }
  };

  const resetState = () => {
    clearEmailBody(editor());
    setBodyMacro('');
    session.dispatch({ type: 'reset' });
    form.reset();
  };

  const clearDraftState = () => {
    ctx.onDraftRemoved();
    props.setShowReply?.(false);
  };

  const deleteDraftAndReset = async () => {
    if (submitting() || pendingDeletion() || scheduling()) return;
    // Keep Lexical's deferred reset notification from recreating a discarded draft.
    setPendingDeletion(true);
    autosave.cancel();
    try {
      await autosave.settled().catch(() => {});
      const draftId = savedDraftId();
      if (draftId) {
        try {
          await props.drafts.deleteDraft({
            draftId,
            threadId: savedDraftThreadId(),
            inboxId: activeInboxId(),
          });
        } catch (error) {
          // Sent from another device: the reset below is exactly what that
          // outcome asks for. Anything else keeps the draft.
          if (
            !(error instanceof DraftPersistRejected) ||
            error.code !== 'DRAFT_ALREADY_SENT'
          )
            throw error;
          props.notices.feedback.alert('This reply was already sent');
        }
      }
      resetState();
      form.setReplyAppended(false);
      clearDraftState();
    } finally {
      // Yield past any sync/microtask save scheduling triggered by resetState,
      // then cancel the resulting timer and re-enable autosave. Runs on both
      // success and error paths so a failed delete doesn't leave the user
      // unable to save further edits.
      setTimeout(() => {
        autosave.cancel();
        setPendingDeletion(false);
      }, 0);
    }
  };

  const handleUserMention = (mention: UserMentionRecord) => {
    if (recipients.disabled()) return;
    addUserMentionToCc({
      mention,
      recipientOptions: ctx.recipientOptions(),
      toRecipients: form.recipients().to,
      ccRecipients: form.recipients().cc,
      bccRecipients: form.recipients().bcc,
      setCc: (next) => form.setRecipients('cc', next),
      onRecipientAdded: (email) => {
        props.notices.feedback.success(`${email} added to CC`);
      },
    });
  };

  const handleAddAttachments = async (files: File[]) => {
    // Attachments cannot be added while offline: a queued draft save durably
    // carries only the draft's text, while attached file bytes live solely in
    // the open composer's memory and upload only on a later save that
    // commits. Rather than accept an attachment that can silently miss the
    // draft, refuse at attach time.
    if (deviceLooksOffline()) {
      await props.notices.blockingNotice({
        title: "You're offline",
        body: "Attachments can't be added while you're offline. Reconnect and try again.",
      });
      return;
    }
    const currentAttachments = form.attachments.list();

    const attachmentsToAddByteSize = files.reduce((sum, f) => sum + f.size, 0);

    if (attachmentsToAddByteSize >= MAX_ATTACHMENTS_BYTES_SIZE) {
      props.notices.feedback.failure(
        `${plural('Attachment', files.length)} exceed 18MB`
      );
      return;
    }

    const currentAttachmentsByteSize = currentAttachments.reduce(
      (sum, a) => sum + (a.type === 'local' ? a.file.size : a.fileSize),
      0
    );

    if (
      currentAttachmentsByteSize + attachmentsToAddByteSize >=
      MAX_ATTACHMENTS_BYTES_SIZE
    ) {
      props.notices.feedback.failure("Can't add more attachments", {
        subtext: 'Total attachments exceed 18MB limit',
      });
      return;
    }

    for (const file of files) {
      form.attachments.add({
        type: 'local',
        file,
      });
    }

    scheduleDraftSave();
  };

  const handleRemoveAttachment = attachmentPersistence.remove;

  const schedule = createEmailSendSchedule({
    delivery: props.delivery,
    notices: props.notices,
    draftId: savedDraftId,
    saveDraft: async () => {
      const draftId = await executeSaveDraft();
      // The schedule endpoint resolves server ids only; a queued save's
      // handle reads as "no draft" so scheduling fails before the wire.
      return session.restSendable() ? draftId : undefined;
    },
    threadId: savedDraftThreadId,
    inboxId: activeInboxId,
    sendTime: form.sendTime,
    setSendTime: form.setSendTime,
    recipientCount: () => {
      const recipients = form.recipients();
      return (
        recipients.to.length + recipients.cc.length + recipients.bcc.length
      );
    },
  });
  const scheduling = schedule.pending;
  const scheduleBlocked = () => pendingDeletion() || sending();
  const handleSendTimeChange = (date: Date | null) =>
    scheduleBlocked() ? Promise.resolve() : schedule.change(date);

  const hasBodyText = () => bodyMacro().trim().length > 0;
  const sendActionDisabled = () =>
    pendingDeletion() ||
    submitting() ||
    scheduling() ||
    attachmentPersistence.uploading() ||
    !!form.sendTime();
  const scheduleSendDisabled = () =>
    scheduleBlocked() ||
    scheduling() ||
    (form.recipients().to.length === 0 &&
      form.recipients().cc.length === 0 &&
      form.recipients().bcc.length === 0);
  const toggleQuotedText = () => {
    const replyingTo = replyTarget;
    if (!replyingTo) return;

    const currentlyAppended = form.replyAppended();
    form.setReplyAppended(!currentlyAppended);
    // Explicitly showing quoted text via the toolbar reveals it uncollapsed
    if (!currentlyAppended) setQuoteCollapsed(false);

    editor()?.dispatchCommand(TOGGLE_APPEND_EMAIL_THREAD_COMMAND, {
      replyingTo,
      replyType: form.replyType(),
      visible: !currentlyAppended,
      isPersonal: ctx.isPersonalReply(),
    });

    editor()?.update(() => {
      $getRoot().getFirstChild()?.selectStart();
    });
  };

  return {
    onContentChange: handleChange,
    handleUserMention,
    scrollContainer,
    form,
    activeInboxId,
    activeInboxEmail,
    replyType: form.replyType,
    signatureHtml: replySignatureHtml,
    setIncludeSignature,
    setScrollContainer,
    composerExpanded,
    setComposerExpanded,
    quoteCollapsed,
    setQuoteCollapsed,
    savedDraftId,
    handleEditorConnect,
    isSending: submitting,
    recipients,
    collectDraft,
    scheduleDraftSave,
    persistDraftOnSenderSwitch,
    hasPaidAccess,
    sendEmail,
    deleteDraftAndReset,
    handleAddAttachments,
    handleRemoveAttachment,
    handleSendTimeChange,
    hasBodyText,
    sendActionDisabled,
    scheduleSendDisabled,
    toggleQuotedText,
  };
}
