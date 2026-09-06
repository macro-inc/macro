import {
  MACRO_EMAIL_SIGNATURE,
  MAX_ATTACHMENTS_BYTES_SIZE,
} from '@app/features/email-compose/core/constants';
import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { isPersonalMessage } from '@app/features/email-message/core/is-personal-message';
import type {
  EmailComposeServices,
  EmailUndoHandle,
} from '../context/compose-services';
import type { EmailReplySession } from '../context/email-form-dependencies';
import type { EmailDraft } from '../core/email-draft';
import { createComposeOperation } from '../primitives/compose-operation';
import { createAttachmentPersistence } from './attachment-persistence';
import { createEmailSendSchedule } from './email-send-schedule';
import { createReplyComposerFocus } from './reply-composer-focus';
import { createReplyRecipientFields } from './reply-recipient-fields';
import { createEmailUndoStore } from './undo-store';

type EmailDraftId = string | null;

import type { UserMentionRecord } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { setEditorStateFromHtml } from '@core/component/LexicalMarkdown/utils/setEditorStateFromHtml';

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
import { convertEmailRecipientToContactInfo } from '../core/recipient-conversion';
import { getReplyTypeFromDraft } from '../core/reply-type';
import type { DraftFormAttachment } from '../primitives/email-form-state';
import type {
  EmailFormContextValue,
  FormAccessKey,
} from '../primitives/email-form-types';
import { addUserMentionToCc } from '../primitives/mention-to-cc';
import {
  clearEmailBody,
  hasDraftContent,
  prepareEmailBody,
  prepareMacroBody,
  TOGGLE_APPEND_EMAIL_THREAD_COMMAND,
} from '../primitives/prepare-email-body';
import { endUndoSend } from '../primitives/undo-send-claim';

type UndoReplySnapshot = {
  threadId: string;
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

export type ReplyInputProps = {
  newMessage?: boolean;
  services: EmailComposeServices;
  session: EmailReplySession;
  sourceEntityId: string;
  replyingTo: Accessor<EmailMessage | undefined>;
  isEditingExisting?: boolean;
  draft?: EmailMessage;
  preloadedBody?: string;
  preloadedHtml?: string;
  /** Seed identity of the draft this composer mounted from — becomes part of
   * the form-state cache key so a remount on a newer draft version gets a
   * freshly seeded form. See EmailInput's seed key. */
  formSeed?: string;
  /** Reports the composer gaining local state worth keeping — a first edit
   * or save (every modification funnels through scheduleDraftSave) or an
   * undo-send restore. The parent latches the seed key on it so the input
   * stops remounting on later draft versions. */
  onEngaged?: () => void;
  sideEffectOnSend?: (newMessageId: EmailDraftId | null) => void;
  onMarkDone?: (opts?: {
    silent?: boolean;
    onUndoHandle?: (handle: EmailUndoHandle) => void;
    nextEntityId?: string;
  }) => void;
  setShowReply?: Setter<boolean>;
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
  unframed?: boolean;
  mobileDrawer?: {
    onClose: () => void;
  };
};
export type ReplyEditorOptions = {
  namespace: string;
  onChange?: (markdown: string) => void;
  onUserMention?: (mention: UserMentionRecord) => void;
  onDocumentMention?: (item: { id: string }) => void;
  onPasteFilesAndDirs?: (
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[]
  ) => void;
  scrollContainer?: Accessor<HTMLElement | undefined>;
};

export function createReplyInput(
  props: ReplyInputProps,
  editor: Accessor<LexicalEditor | undefined>,
  dom: {
    container: Accessor<HTMLDivElement | undefined>;
    footer: Accessor<HTMLDivElement | undefined>;
  },
  forms: (key?: FormAccessKey) => EmailFormContextValue
) {
  const ctx = props.session;
  const form = createMemo(() => {
    const replyingTo = props.replyingTo();

    // If neither `replyingTo` or `draft` exist, we'll have an empty
    // initial state
    if (!replyingTo && !props.draft) {
      return forms();
    }

    // If we have `replyingTo`, we're going to be
    // creating a reply to a message so we can derive our state
    // from the `replyingTo` and a possible existing draft
    if (replyingTo && replyingTo.db_id) {
      return forms({
        type: 'replying_to',
        messageID: replyingTo.db_id,
        seed: props.formSeed,
      });
    }

    // If we only have the draft available, then we're most likely
    // editing a draft in a new thread with no other messages
    if (props.draft && props.draft.db_id) {
      return forms({
        type: 'draft',
        messageID: props.draft.db_id,
        seed: props.formSeed,
      });
    }

    // Fallback to empty state
    return forms();
  });
  const sourceEntityId = props.sourceEntityId;
  const undoKey = `${sourceEntityId}:${props.replyingTo()?.db_id ?? props.draft?.replying_to_id ?? props.draft?.db_id ?? 'new'}`;
  const services = props.services;
  const userEmail = services.viewerEmail;

  const toHeaderLinkId = services.accounts.headerId;
  const primaryLinkId = services.accounts.primaryId;
  // The inbox this input acts in: the open thread's inbox, else the primary
  // inbox for a new message. Mutations send it as X-Email-Link-Id when it's a
  // non-primary inbox so the draft/send targets the right account.
  const activeLinkId = () =>
    form().selectedLinkId() ??
    ctx.thread()?.link_id ??
    props.draft?.link_id ??
    primaryLinkId() ??
    services.accounts.inboxes()[0]?.id;
  const headerLinkId = () => toHeaderLinkId(activeLinkId());
  // The address of the inbox this input sends from, for the "from" display.
  const activeInboxEmail = () =>
    services.accounts.inboxes().find((l) => l.id === activeLinkId())
      ?.email_address ?? userEmail();

  // The full Link object for the sending inbox (for its saved signature and the
  // "add to replies & forwards" preference).
  const sendingLink = createMemo(() =>
    services.accounts.inboxes().find((l) => l.id === activeLinkId())
  );
  const signature = () => sendingLink()?.settings.signature ?? undefined;
  // Whether this reply includes the signature. Defaults on, reset per reply,
  // and dismissable via the preview ✕.
  const [includeSignature, setIncludeSignature] = createSignal(true);
  // Signature HTML for the preview (and whether to show it): only for
  // replies/forwards, when the inbox's "add to replies & forwards" setting is on
  // and the user hasn't dismissed it. The backend does the actual injection on
  // send — this just mirrors when that will happen.
  const replySignatureHtml = (): string | undefined =>
    services.signaturesEnabled() &&
    props.replyingTo() &&
    includeSignature() &&
    sendingLink()?.settings.signature_on_replies_forwards
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
    !form().replyAppended()
  );
  const recipients = createReplyRecipientFields({
    values: () => form().recipients(),
    setValues: (field, values) => form().setRecipients(field, values),
    onChange: scheduleDraftSave,
    container: dom.container,
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

  // The draft row this composer upserts into: the server draft when one
  // exists, else the one the undone send restores.
  const [savedDraftId, setSavedDraftId] = createSignal<
    EmailDraftId | undefined
  >(props.draft?.db_id ?? restoredSnapshot?.draftId ?? undefined);

  const editorOptions: ReplyEditorOptions = {
    namespace: 'email-base-input-markdown',
    scrollContainer,
    onChange: (markdown) => handleChange(markdown),
    onUserMention: (mention) => handleUserMention(mention),
    onDocumentMention: (item) => {
      services.makePublic(item.id);
      scheduleDraftSave();
    },
    onPasteFilesAndDirs: (files, directories) => {
      services.uploadEditorFiles({
        editor: editor(),
        sourceId: sourceEntityId,
        files,
        directories,
        onUploaded: (ids) => {
          ids.forEach(services.makePublic);
          scheduleDraftSave();
        },
      });
    },
  };

  // Consume the undo-send snapshot so a later composer mount doesn't restore
  // it again. Use bodyHtml as initialHtml for the editor, restore attachments
  // on mount.
  if (restoredSnapshot) {
    onMount(() => {
      // Restored content is local state worth keeping — latch the seed.
      props.onEngaged?.();
      for (const attachment of restoredSnapshot.attachments) {
        form().attachments.add(attachment);
      }
      setIncludeSignature(restoredSnapshot.includeSignature);
      form().setReplyAppended(restoredSnapshot.replyAppended);
      // Reopen with the quote visible, as it was when the send was undone.
      if (restoredSnapshot.replyAppended) setQuoteCollapsed(false);
    });
  }

  // Register a callback so stale undoSend closures from a previous mount can
  // restore state into this (the live) component instance.
  const unregisterUndo = replyUndo.register(undoKey, (snapshot) => {
    const draftId = snapshot.draftId;
    props.onEngaged?.();
    setSavedDraftId(draftId);
    const currentEditor = editor();
    if (currentEditor && snapshot.bodyHtml) {
      setEditorStateFromHtml(currentEditor, snapshot.bodyHtml);
    }
    for (const attachment of snapshot.attachments) {
      form().attachments.add(attachment);
    }
    setIncludeSignature(snapshot.includeSignature);
    form().setReplyAppended(snapshot.replyAppended);
    // Reopen with the quote visible, as it was when the send was undone.
    if (snapshot.replyAppended) setQuoteCollapsed(false);
  });
  onCleanup(unregisterUndo);

  const initialHtml = () => restoredSnapshot?.bodyHtml ?? props.preloadedHtml;
  const handleEditorConnect = () => {
    const currentEditor = editor();
    if (!currentEditor) return;
    form().setCapturedEditor(currentEditor);
    const html = initialHtml();
    if (html) {
      // Restore content without letting selection reconciliation grab focus
      currentEditor.update(() => {
        $addUpdateTag('skip-dom-selection');
        setEditorStateFromHtml(currentEditor, html, true);
      });
    }
  };

  let pendingMentions: { documentId: string }[] = [];
  const [shouldMarkDoneOnSuccess, setShouldMarkDoneOnSuccess] =
    createSignal(false);
  // Undo entry for the mark-done triggered by the latest send, so undo-send
  // can reverse it. Cleared on each send: undo-send must only un-mark-done
  // when this send did the marking.
  let markDoneUndoHandle: EmailUndoHandle | undefined;
  let pendingMarkDoneNavigationTargetId: string | undefined;

  // Everything that follows a successful unschedule: consume the send
  // snapshot, scrub the sent message from the thread cache, restore the
  // server-side draft and the composer, and reverse the send's mark-done.
  const restoreAfterUndoSend = async (
    draftId: string,
    linkId: string | undefined
  ) => {
    const snapshot = replyUndo.take(draftId);

    // Remove the sent message from the thread cache so it disappears from
    // the list. Prefer the snapshot's threadId — captured at send time, it
    // survives navigation — while the context read covers snapshotless undos
    // in a still-mounted thread.
    const threadId = snapshot?.threadId ?? ctx.thread()?.db_id;
    if (threadId) services.prepareUndo(threadId, draftId);

    // Overwrite the server-side draft with the pre-send content before
    // anything loads it into a composer (thread revisit, refetch, next
    // session).
    if (snapshot) {
      await services.restoreDraft(
        snapshot.draftRestore,
        snapshot.bodyHtml,
        linkId
      );
    }

    // GraphQL mode renders the thread from the normalized cache, which the
    // setQueryData surgery above can't reach — refetch through it instead.
    // After the draft-body restore, so the single fetch returns the message
    // as a draft with the pre-send content, dropping it from the message
    // list and re-seeding the draft map in one pass.
    if (threadId) services.refreshAfterUndo(threadId);

    if (snapshot) {
      // Resolve the live registration after cache updates and unmounts settle.
      setTimeout(() => replyUndo.restore(undoKey, snapshot), 0);
      props.setShowReply?.(true);
    }

    // Reverse the mark-done this send triggered (restores the soup rows,
    // notification state, and unarchives), then refresh the thread's soup
    // item the same way a send does so inbox views show the restored draft.
    const doneHandle = markDoneUndoHandle;
    markDoneUndoHandle = undefined;
    if (doneHandle) {
      await doneHandle.undo({
        onError: () =>
          services.feedback.failure('Failed to restore thread to inbox'),
      });
    }
    if (threadId) {
      void services.refreshThreadPreview(threadId);
    }
  };

  // linkId is the X-Email-Link-Id header value the send itself used, resolved
  // at send time. Undo can fire after navigation has disposed this component's
  // reactive state (mark-done navigates away).
  const undoSend = (draftId: string, linkId: string | undefined) =>
    services.undoSend({
      draftId,
      linkId,
      onUndone: () => restoreAfterUndoSend(draftId, linkId),
    });

  const sendMutation = createComposeOperation(services.sendMessage, {
    onSuccess: async ({ message }, vars) => {
      // Cancel the post-reset save scheduled by sendEmail's resetState() and
      // re-enable autosave for any future edits in this BaseInput instance
      // (covers new-message flows where replyingTo never changes).
      if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
      pendingSend = false;
      const draftId = message.db_id;
      // This send opens a fresh undo cycle for the draft id.
      if (draftId) endUndoSend(draftId);
      const sendLinkId = vars.linkId;
      const toastId = services.feedback.success('Email sent', {
        actions: draftId
          ? [
              {
                label: 'Undo',
                onClick: () => {
                  if (toastId != null) services.feedback.dismiss(toastId);
                  void undoSend(draftId, sendLinkId);
                },
              },
            ]
          : undefined,
        duration: 5_000,
      });
      pendingMentions.forEach((mention) => {
        services.recordMention(sourceEntityId, mention.documentId);
      });
      pendingMentions = [];
      refetchThreadMessages();
      props.sideEffectOnSend?.(message.db_id ?? null);
      if (shouldMarkDoneOnSuccess()) {
        // Silent: the "Email sent" toast is already up and the mark-done
        // toast would replace it.
        props.onMarkDone?.({
          silent: true,
          onUndoHandle: (handle) => {
            markDoneUndoHandle = handle;
          },
          nextEntityId: pendingMarkDoneNavigationTargetId,
        });
        pendingMarkDoneNavigationTargetId = undefined;
        setShouldMarkDoneOnSuccess(false);
      }
    },
    onError: () => {
      // Restore autosave so the user can keep editing after a failed send.
      if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
      pendingSend = false;
      pendingMarkDoneNavigationTargetId = undefined;
      services.feedback.failure('Failed to send email');
    },
  });

  const attachmentPersistence = createAttachmentPersistence({
    services,
    attachments: () => form().attachments,
    draftId: savedDraftId,
    linkId: headerLinkId,
  });

  const addForwardedAttachmentsMutation = createComposeOperation(
    services.addForwardedAttachments
  );
  const saveDraftMutation = createComposeOperation(services.saveDraft);
  const deleteDraftMutation = createComposeOperation(services.deleteDraft);

  function refetchThreadMessages() {
    const threadId = ctx.thread()?.db_id;
    if (threadId) {
      services.markDraftSaved(threadId);
    }
  }

  // Attach side-effect handlers on mount; they replay against current state
  onMount(() => {
    form().setOnDirty(() => {
      scheduleDraftSave();
    });

    form().setOnReplyTypeApplied((rt) => {
      setComposerExpanded(false);
      if (rt === 'forward') {
        setQuoteCollapsed(true);
        focus.forward();
      } else if (rt === 'reply' || rt === 'reply-all') {
        focus.reply();
      }
    });
  });

  const effectiveReplyType = createMemo(() => {
    return (
      form().replyType() ??
      getReplyTypeFromDraft(props.draft) ??
      ((props.replyingTo()?.to.length ?? 0) +
        (props.replyingTo()?.cc.length ?? 0) >
      1
        ? 'reply-all'
        : 'reply')
    );
  });

  let draftSaveTimer: number | undefined;
  let pendingDeletion = false;
  let pendingSend = false;
  const DRAFT_DEBOUNCE_MS = 500;

  function collectDraft() {
    $removeAllWatermarkNodes(editor());
    const prepared = prepareEmailBody(editor());
    if (!prepared) {
      services.reportError(
        new Error('Unable to prepare email body for draft collection.')
      );
      return null;
    }
    if (
      !hasDraftContent(
        prepared.bodyText,
        form().subject(),
        form().attachments.list().length
      )
    ) {
      return null;
    }
    // We attach the drafts entirely using bodyHTML (because this is how the appended reply parsing works) so we are not including bodyMacro or bodyText
    return {
      bcc: form().recipients().bcc.map(convertEmailRecipientToContactInfo),
      body_html: prepared.bodyHtml,
      cc: form().recipients().cc.map(convertEmailRecipientToContactInfo),
      provider_id: props.draft?.provider_id,
      replying_to_id: props.replyingTo()?.db_id,
      subject: form().subject(),
      to: form().recipients().to.map(convertEmailRecipientToContactInfo),
    };
  }

  async function executeSaveDraft(skipSoupRefetch = false) {
    if (sendMutation.pending() || pendingDeletion || pendingSend) {
      return;
    }
    const draftToSave = collectDraft();
    if (!draftToSave) {
      const draftId = savedDraftId();
      if (draftId) {
        await deleteDraftMutation.run({
          draftId,
          threadId: ctx.thread()?.db_id,
          linkId: headerLinkId(),
          skipSoupRefetch,
        });
        refetchThreadMessages();
      }
      setSavedDraftId(undefined);
      return;
    }
    const currentThread = ctx.thread();
    const newMessage = props.newMessage ?? false;

    if (!currentThread && !newMessage) {
      services.reportError(new Error('Failed to save draft: thread not found'));
      return;
    }

    if (newMessage && currentThread) {
      services.reportError(
        new Error(
          'Failed to save draft: new message and current thread cannot be provided together'
        )
      );
      return;
    }

    const draftResponse = await saveDraftMutation.run({
      draft: {
        ...draftToSave,
        db_id: savedDraftId(),
        provider_thread_id: currentThread?.provider_id,
        thread_db_id: currentThread?.db_id,
      },
      linkId: headerLinkId(),
      skipSoupRefetch,
    });

    const draftId = draftResponse.draft.db_id;
    if (draftId) {
      await attachmentPersistence.upload(draftId);

      // Sync forwarded attachments
      const forwardedAttachments = form()
        .attachments.list()
        .filter((a) => a.type === 'forwarded') as Extract<
        DraftFormAttachment,
        { type: 'forwarded' }
      >[];

      if (forwardedAttachments.length) {
        await addForwardedAttachmentsMutation.run({
          draftID: draftId,
          attachments: forwardedAttachments.map((a) => ({
            attachmentID: a.attachmentID,
          })),
          linkId: headerLinkId(),
        });
      }

      setSavedDraftId(draftId);
      refetchThreadMessages();
      return draftId;
    }
  }

  // The reply target the pending debounced save was scheduled against.
  // Captured at schedule time — a live interactive context — because the
  // unmount flush below cannot trust props during disposal.
  let pendingSaveReplyingToId: string | undefined;

  function scheduleDraftSave() {
    props.onEngaged?.();
    pendingSaveReplyingToId = untrack(() => props.replyingTo()?.db_id);
    if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(() => {
      draftSaveTimer = undefined;
      void executeSaveDraft();
    }, DRAFT_DEBOUNCE_MS);
  }

  onCleanup(() => {
    const flushPending = draftSaveTimer !== undefined;
    if (draftSaveTimer) {
      window.clearTimeout(draftSaveTimer);
      draftSaveTimer = undefined;
    }
    // A send or discard already owns this composer's state; saving here
    // would resurrect content those flows just cleared.
    if (pendingSend || pendingDeletion) return;

    // Flush the pending debounced save so dismissal doesn't drop the last
    // edits server-side; a failure surfaces through the mutation's services.feedback.
    if (flushPending) {
      try {
        // Only while the reply target still reads as the one the save was
        // scheduled against — mid-disposal it can come back empty or stale,
        // and a save without replying_to_id would unlink the server draft
        // from its message.
        if (
          untrack(() => props.replyingTo()?.db_id) === pendingSaveReplyingToId
        ) {
          // The mutation's own onError reports the failure (toast + console);
          // this catch only keeps the post-disposal rejection from surfacing
          // as unhandled.
          executeSaveDraft().catch(() => {});
        }
      } catch {
        // Props already disposed; the next mount's autosave persists it.
      }
    }
  });

  // Persist the draft immediately when the user switches the sending inbox, even
  // without a text edit, so it moves to the new inbox and the choice survives a
  // refresh. Driven by the explicit switch (below) rather than inbox reactivity.
  const persistDraftOnSenderSwitch = (linkId: string) => {
    props.onEngaged?.();
    form().setSelectedFromLink(linkId);
    if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
    void executeSaveDraft();
  };

  // After a send, the bottom input stays mounted and its replyingTo flips to
  // the just-sent message once the thread refetches. Cancel the inhibited
  // post-send save and re-enable saves so a fresh edit under the new form
  // context can be persisted. The memo gates on the db_id *value*: replyingTo
  // is recreated on every thread/draft refetch (e.g. after a debounced draft
  // save), and resetting on those would resurrect a dismissed signature.
  const replyingToDbId = createMemo(() => props.replyingTo()?.db_id);
  createEffect(
    on(
      replyingToDbId,
      () => {
        if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
        pendingSend = false;
        // Each new reply starts with the signature included again.
        setIncludeSignature(true);
      },
      { defer: true }
    )
  );

  createEffect(() => {
    const requestMessageId = ctx.replyRequest.messageId();
    const requestReplyType = ctx.replyRequest.replyType();
    const currentMessageId = replyingToDbId();

    if (
      !requestMessageId ||
      !requestReplyType ||
      requestMessageId !== currentMessageId
    ) {
      return;
    }

    if (form().replyType() !== requestReplyType) {
      form().setReplyType(requestReplyType);
    } else if (requestReplyType === 'forward') {
      // setReplyType is skipped when the type is unchanged, so land the
      // cursor in the To field explicitly
      focus.forward();
    }
    // Forwards focus the To field; focusing the editor would steal it back
    if (requestReplyType !== 'forward') {
      form().setShouldFocusInput(true);
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

  const hasPaidAccess = services.hasPaidAccess;

  const sendEmail = async (markDone = false) => {
    if (scheduling()) return;
    if (sendMutation.pending() || attachmentPersistence.uploading()) return;

    const to = form().recipients().to.map(convertEmailRecipientToContactInfo);
    const cc = form().recipients().cc.map(convertEmailRecipientToContactInfo);
    const bcc = form().recipients().bcc.map(convertEmailRecipientToContactInfo);

    if ((to?.length ?? 0) + (cc?.length ?? 0) + (bcc?.length ?? 0) === 0) {
      services.feedback.failure('Email failed to send. No recipients provided');
      return;
    }

    const currentThread = ctx.thread();
    const newMessage = props.newMessage ?? false;

    if (!currentThread && !newMessage) {
      services.reportError(
        new Error("Can't send email, no email thread found")
      );
      services.feedback.failure('Email failed to send');
      return;
    }

    if (newMessage && currentThread) {
      services.feedback.failure('Email failed to send');
      services.reportError(
        'New message and thread cannot be provided together'
      );
      return;
    }

    let linkId: string | undefined = currentThread?.link_id;
    if (newMessage || !linkId) {
      if (services.accounts.loading()) {
        services.feedback.alert('Loading email accounts...');
        return;
      }

      if (services.accounts.failed()) {
        services.feedback.failure(
          'Email failed to send: Could not load email accounts'
        );
        services.reportError('Failed to load email links');
        return;
      }

      const linksData = { links: services.accounts.inboxes() };
      if (!linksData || linksData.links.length < 1) {
        services.feedback.failure(
          'Email failed to send: No email account connected'
        );
        services.reportError('No links found');
        return;
      }
      linkId = primaryLinkId() ?? linksData.links[0].id;
    }

    const currentEditor = editor();

    // Sending a reply marks the thread done. Gated on inbox_visible because
    // onMarkDone (archiveThread) toggles: an already-archived thread (e.g.
    // replying from search or the sent view) would be unarchived.
    const willMarkDone = markDone || (currentThread?.inbox_visible ?? false);
    pendingMarkDoneNavigationTargetId = willMarkDone
      ? ctx.getMarkDoneNavigationTargetId()
      : undefined;

    // Ensure draft is saved before sending so undo-send always has a draft to restore
    if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
    await executeSaveDraft(willMarkDone);

    // Snapshot editor state before watermark so undo-send can restore it.
    // Remember by draft so sends in separate composers cannot replace each other.
    if (currentEditor) {
      const snapshotHtml = currentEditor.read(() =>
        $generateHtmlFromNodes(currentEditor)
      );
      const snapshotDraftId = savedDraftId();
      const snapshotThreadId = ctx.thread()?.db_id;
      if (snapshotDraftId && snapshotThreadId) {
        replyUndo.remember({
          threadId: snapshotThreadId,
          draftId: snapshotDraftId,
          bodyHtml: snapshotHtml,
          attachments: [...form().attachments.list()],
          includeSignature: includeSignature(),
          replyAppended: form().replyAppended(),
          draftRestore: {
            bcc,
            cc,
            db_id: snapshotDraftId,
            provider_id: props.draft?.provider_id,
            provider_thread_id: currentThread?.provider_id,
            replying_to_id: props.replyingTo()?.db_id,
            subject: form().subject(),
            thread_db_id: currentThread?.db_id,
            to,
          },
        });
      }
    }

    // Scheduling may have started while the draft save was pending.
    if (scheduling() || form().sendTime()) {
      return;
    }

    // Append watermark after all validation passes so failed sends don't
    // leave orphaned watermark nodes in the editor tree.
    const cleanupWatermark = $appendWatermarkNodeToLast(
      currentEditor,
      !hasPaidAccess() ? MACRO_EMAIL_SIGNATURE : undefined
    );

    const replyingTo = props.replyingTo();

    const prepared = prepareEmailBody(
      currentEditor,
      replyingTo
        ? {
            replyType: effectiveReplyType(),
            replyingTo,
          }
        : undefined
    );
    if (!prepared) {
      cleanupWatermark();
      return;
    }

    pendingMentions = prepared.mentions;
    setShouldMarkDoneOnSuccess(willMarkDone);
    markDoneUndoHandle = undefined;

    const processedMacroBody = prepareMacroBody(bodyMacro());

    const currentDraftID = savedDraftId();

    sendMutation.start({
      message: {
        db_id: currentDraftID,
        bcc,
        body_html: prepared.bodyHtml,
        body_macro: processedMacroBody,
        body_text: prepared.bodyText,
        cc,
        provider_id: props.draft?.provider_id,
        provider_thread_id: currentThread?.provider_id,
        replying_to_id: props.replyingTo()?.db_id,
        subject: form().subject(),
        thread_db_id: currentThread?.db_id,
        to,
        // Replies/forwards follow the inbox's "add to replies & forwards"
        // setting on the backend; only signal an explicit per-reply dismiss.
        include_signature: includeSignature() ? undefined : false,
      },
      linkId: toHeaderLinkId(linkId),
      skipSoupRefetch: willMarkDone,
    });

    // Block any save scheduled by reset side effects (form().reset() callDirty,
    // clearEmailBody editor onChange firing on a microtask). Without this, the
    // 500ms timer fires after the thread refetches, the form memo switches to
    // the just-sent message's reply context, and we POST an empty draft
    // replying to the message we just sent — flipping it back to is_draft=TRUE.
    pendingSend = true;
    resetState();
    clearDraftState();

    cleanupWatermark();
  };

  const resetState = () => {
    clearEmailBody(editor());
    setBodyMacro('');
    setSavedDraftId(undefined);
    form().reset();
  };

  const clearDraftState = () => {
    const replyingToId = props.replyingTo()?.db_id;
    if (replyingToId) {
      ctx.drafts.deleteDraftForMessage(replyingToId);
    }
    props.setShowReply?.(false);
  };

  const deleteDraftAndReset = async () => {
    // Block any save scheduled by resetState's side effects (sync form.reset
    // callDirty + async editor onChange listener). When clearDraftState() has
    // a setShowReply, the BaseInput unmounts and the flag goes away with it;
    // when it doesn't (e.g. the bottom-of-thread input), the component stays
    // mounted and we must restore the flag so subsequent edits can autosave.
    pendingDeletion = true;
    if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
    const draftId = savedDraftId();
    try {
      if (draftId) {
        await deleteDraftMutation.run({
          draftId,
          threadId: ctx.thread()?.db_id,
          linkId: headerLinkId(),
        });
        refetchThreadMessages();
      }
      resetState();
      form().setReplyAppended(false);
      clearDraftState();
    } finally {
      // Yield past any sync/microtask save scheduling triggered by resetState,
      // then cancel the resulting timer and re-enable autosave. Runs on both
      // success and error paths so a failed delete doesn't leave the user
      // unable to save further edits.
      setTimeout(() => {
        if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
        pendingDeletion = false;
      }, 0);
    }
  };

  const handleUserMention = (mention: UserMentionRecord) => {
    addUserMentionToCc({
      mention,
      recipientOptions: ctx.recipientOptions(),
      toRecipients: form().recipients().to,
      ccRecipients: form().recipients().cc,
      bccRecipients: form().recipients().bcc,
      setCc: (next) => form().setRecipients('cc', next),
      onRecipientAdded: (email) => {
        services.feedback.success(`${email} added to CC`);
      },
    });
  };

  // Focus when external shouldFocus signal is set to true. The builder creates
  // the Lexical editor immediately; requestAnimationFrame waits for the root to
  // connect before focusing.
  createEffect(() => {
    if (!form().shouldFocusInput()) return;
    if (services.isTouch()) {
      form().setShouldFocusInput(false);
      return;
    }
    // Forwards focus the To field; a stale flag consumed here after the
    // editor mounts would move the caret into the editor body instead.
    if (effectiveReplyType() === 'forward') {
      form().setShouldFocusInput(false);
      return;
    }
    const ed = editor();
    if (!ed) return;
    focus.editor(() => form().setShouldFocusInput(false));
  });

  const handleAddAttachments = (files: File[]) => {
    const currentAttachments = form().attachments.list();

    const attachmentsToAddByteSize = files.reduce((sum, f) => sum + f.size, 0);

    if (attachmentsToAddByteSize >= MAX_ATTACHMENTS_BYTES_SIZE) {
      services.feedback.failure(
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
      services.feedback.failure("Can't add more attachments", {
        subtext: 'Total attachments exceed 18MB limit',
      });
      return;
    }

    for (const file of files) {
      form().attachments.add({
        type: 'local',
        file,
      });
    }

    scheduleDraftSave();
  };

  const handleRemoveAttachment = attachmentPersistence.remove;

  const schedule = createEmailSendSchedule({
    services,
    draftId: savedDraftId,
    saveDraft: executeSaveDraft,
    threadId: () => ctx.thread()?.db_id,
    linkId: headerLinkId,
    sendTime: () => form().sendTime(),
    setSendTime: (date) => form().setSendTime(date),
    recipientCount: () => {
      const recipients = form().recipients();
      return (
        recipients.to.length + recipients.cc.length + recipients.bcc.length
      );
    },
  });
  const scheduling = schedule.pending;
  const handleSendTimeChange = schedule.change;

  const hasBodyText = () => bodyMacro().trim().length > 0;
  const sendActionHidden = () =>
    services.isTouch() &&
    !hasBodyText() &&
    // Forwards carry the quoted thread as content, so send is available without typing anything.
    effectiveReplyType() !== 'forward';
  const sendActionDisabled = () =>
    scheduling() ||
    attachmentPersistence.uploading() ||
    sendMutation.pending() ||
    !!form().sendTime();
  const scheduleSendDisabled = () =>
    scheduling() ||
    (form().recipients().to.length === 0 &&
      form().recipients().cc.length === 0 &&
      form().recipients().bcc.length === 0);
  const toggleQuotedText = () => {
    const replyingTo = props.replyingTo();
    if (!replyingTo) return;

    const currentlyAppended = form().replyAppended();
    form().setReplyAppended(!currentlyAppended);
    // Explicitly showing quoted text via the toolbar reveals it uncollapsed
    if (!currentlyAppended) setQuoteCollapsed(false);

    editor()?.dispatchCommand(TOGGLE_APPEND_EMAIL_THREAD_COMMAND, {
      replyingTo,
      replyType: effectiveReplyType(),
      visible: !currentlyAppended,
      isPersonal: isPersonalMessage(
        replyingTo,
        userEmail(),
        ctx.messages.personalSenders()
      ),
    });

    editor()?.update(() => {
      $getRoot().getFirstChild()?.selectStart();
    });
  };

  const handleEditorDrop = (
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[],
    event: DragEvent | undefined,
    onUploaded: () => void
  ) => {
    const currentEditor = editor();
    if (!currentEditor || !event) return;
    services.uploadEditorFiles({
      editor: currentEditor,
      sourceId: sourceEntityId,
      files,
      directories,
      dropEvent: event,
      onUploaded: (ids) => {
        onUploaded();
        ids.forEach(services.makePublic);
        scheduleDraftSave();
      },
    });
  };

  return {
    editorOptions,
    form,
    activeLinkId,
    activeInboxEmail,
    replyType: effectiveReplyType,
    signatureHtml: replySignatureHtml,
    setIncludeSignature,
    setScrollContainer,
    composerExpanded,
    setComposerExpanded,
    quoteCollapsed,
    setQuoteCollapsed,
    savedDraftId,
    initialHtml,
    handleEditorConnect,
    isSending: sendMutation.pending,
    isUploading: attachmentPersistence.uploading,
    recipients,
    collectDraft,
    scheduleDraftSave,
    persistDraftOnSenderSwitch,
    hasPaidAccess,
    sendEmail,
    deleteDraftAndReset,
    handleAddAttachments,
    handleRemoveAttachment,
    handleEditorDrop,
    handleSendTimeChange,
    sendActionHidden,
    sendActionDisabled,
    scheduleSendDisabled,
    toggleQuotedText,
  };
}
