import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { EmailAttachmentPill } from '@block-email/component/AttachmentPill';
import type { DraftFormAttachment } from '@block-email/component/createEmailFormState';
import { EmailDateSelector } from '@block-email/component/email-date-selector';
import { MacroSignatureButton } from '@block-email/component/MacroSignatureButton';
import {
  MACRO_EMAIL_SIGNATURE,
  MAX_ATTACHMENTS_BYTES_SIZE,
} from '@block-email/constants';
import { addUserMentionToCc } from '@block-email/util/mentionToCc';
import { useHasPaidAccess } from '@core/auth';
import { useBlockId } from '@core/block';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { iosCursorScrollPlugin } from '@core/component/LexicalMarkdown/plugins/ios-cursor-scroll';
import { setEditorStateFromHtml } from '@core/component/LexicalMarkdown/utils';
import {
  createFilesReadyHandler,
  getDragDropPosition,
} from '@core/component/LexicalMarkdown/utils/fileUploadUtils';
import type { UserMentionRecord } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { toast } from '@core/component/Toast/Toast';
import {
  ENABLE_EMAIL_SCHEDULED_SEND,
  ENABLE_EMAIL_SIGNATURES_FLAG,
  ENABLE_EMAIL_SIGNATURES_OVERRIDE,
  ENABLE_GRAPHQL_SOUP,
} from '@core/constant/featureFlags';
import { useEmail } from '@core/context/user';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { fileSelector } from '@core/directive/fileSelector';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { trackMention } from '@core/signal/mention';
import { plural } from '@core/util/string';
import { handleFileFolderDrop } from '@core/util/upload';
import { ToggleButton as KToggleButton } from '@kobalte/core/toggle-button';
import { $generateHtmlFromNodes } from '@lexical/html';
import {
  $appendWatermarkNodeToLast,
  $removeAllWatermarkNodes,
} from '@macro-inc/lexical-core';
import { Telemetry } from '@macro-inc/observability';
import ChevronDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import DotsThree from '@phosphor/dots-three.svg';
import Paperclip from '@phosphor/paperclip.svg';
import Trash from '@phosphor/trash.svg';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { queryClient } from '@queries/client';
import {
  useAddForwardedAttachmentsMutation,
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
  useEmailSignature,
  useNonPrimaryEmailLinkIdHeader,
  usePrimaryEmailLinkId,
} from '@queries/email/link';
import {
  fetchAndCacheThread,
  useSendMessageMutation,
  useUnscheduleMessageMutation,
} from '@queries/email/thread';
import { refetchSoupEntity } from '@queries/soup/cache';
import type { UndoHandle } from '@queries/undo';
import { emailClient } from '@service-email/client';
import type {
  ApiDraftInput,
  ApiDraftOutputDbId,
  ApiMessage,
} from '@service-email/generated/schemas';
import { isIOS } from '@solid-primitives/platform';
import { Button, cn, Layer, SendButton, Surface, Tooltip } from '@ui';
import { $addUpdateTag, $getRoot } from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  type Setter,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { isPersonalMessage } from '../util/isPersonalMessage';
import { makeAttachmentPublic } from '../util/makeAttachmentPublic';
import { getFirstName } from '../util/name';
import {
  clearEmailBody,
  hasDraftContent,
  prepareEmailBody,
  prepareMacroBody,
  registerToggleAppendedThread,
  TOGGLE_APPEND_EMAIL_THREAD_COMMAND,
} from '../util/prepareEmailBody';
import { convertEmailRecipientToContactInfo } from '../util/recipientConversion';
import { getReplyTypeFromDraft } from '../util/replyType';
import {
  endUndoSend,
  restoreDraftBodyAfterUndo,
  runUndoSend,
} from '../util/undoSend';
import { SignaturePreview } from './compose/SignaturePreview';
import {
  type EmailRecipient,
  markThreadDraftSaved,
  useEmailContext,
} from './EmailContext';
import { getOrInitEmailFormContext } from './EmailFormContext';
import { FromInboxSelector } from './FromInboxSelector';

false && fileFolderDrop;
false && fileSelector;

const getRecipientDisplayName = (item: EmailRecipient): string => {
  switch (item.kind) {
    case 'user':
    case 'contact':
      return getFirstName(item.data.name) || item.data.email;
    case 'custom':
      return item.data.email;
  }
};

type RecipientFieldId = 'to' | 'cc' | 'bcc';

function RecipientDropRow(props: {
  field: RecipientFieldId;
  class?: string;
  children: JSX.Element;
  dragState: Accessor<{
    recipient: EmailRecipient;
    sourceField: RecipientFieldId;
  } | null>;
  onDrop: (
    targetField: RecipientFieldId,
    recipient: EmailRecipient,
    sourceField: RecipientFieldId
  ) => void;
}) {
  const [isDragOver, setIsDragOver] = createSignal(false);

  const handleDragOver = (e: DragEvent) => {
    const drag = props.dragState();
    if (!drag || drag.sourceField === props.field) return;
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
    const drag = props.dragState();
    if (!drag || drag.sourceField === props.field) return;
    props.onDrop(props.field, drag.recipient, drag.sourceField);
  };

  return (
    <div
      class={cn('flex flex-row items-start min-w-0', props.class)}
      classList={{ 'bg-accent/10': isDragOver() }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {props.children}
    </div>
  );
}

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
  draftRestore: ApiDraftInput;
};
// Set on send, persists across navigation, only consumed by undoSend.
let undoSendSnapshot: UndoReplySnapshot | null = null;
// Only set by undoSend for inline reply remount, consumed on mount.
let undoReplySnapshot: UndoReplySnapshot | null = null;
// Registered by the current BaseInput instance so stale undoSend closures
// from a previous mount can restore state into the live component.
let restoreUndoCallback:
  | ((snapshot: UndoReplySnapshot, draftId: string) => void)
  | null = null;

type CreateConfiguredEmailMarkdownEditorOptions = {
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

function createConfiguredEmailMarkdownEditor(
  options: CreateConfiguredEmailMarkdownEditorOptions
) {
  const editor = buildConfig('markdown')
    .namespace(options.namespace)
    .withMentions({
      onUserMention: options.onUserMention,
      onDocumentMention: options.onDocumentMention,
    })
    .withEmojis()
    .withLinks({ floatingMenu: true, autoLinkMatchMode: 'common-tlds' })
    .withHistory({ timeGap: 400 })
    .withMedia()
    .withCode()
    .withCheckboxToTask()
    .withRestoreFocus()
    .withSelectionData()
    .withFloatingFormatMenu()
    .use((editor) => registerToggleAppendedThread(editor))
    .onChange(options.onChange);

  if (options.onPasteFilesAndDirs) {
    editor.withFilePaste({
      onPasteFilesAndDirs: options.onPasteFilesAndDirs,
    });
  }

  if ((isIOS || isNativeMobilePlatform()) && options.scrollContainer) {
    editor.use(
      iosCursorScrollPlugin({ scrollContainer: options.scrollContainer })
    );
  }

  return editor;
}

export function BaseInput(props: {
  replyingTo: Accessor<ApiMessage | undefined>;
  // TODO: Remove `newMessage` props. It's not used...
  newMessage?: boolean;
  isEditingExisting?: boolean;
  draft?: ApiMessage;
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
  sideEffectOnSend?: (newMessageId: ApiDraftOutputDbId | null) => void;
  onMarkDone?: (opts?: {
    silent?: boolean;
    onUndoHandle?: (handle: UndoHandle) => void;
    nextEntityId?: string;
  }) => void;
  setShowReply?: Setter<boolean>;
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
  unframed?: boolean;
  mobileDrawer?: {
    onClose: () => void;
  };
}) {
  const ctx = useEmailContext();
  const form = createMemo(() => {
    const replyingTo = props.replyingTo();

    // If neither `replyingTo` or `draft` exist, we'll have an empty
    // initial state
    if (!replyingTo && !props.draft) {
      return getOrInitEmailFormContext();
    }

    // If we have `replyingTo`, we're going to be
    // creating a reply to a message so we can derive our state
    // from the `replyingTo` and a possible existing draft
    if (replyingTo && replyingTo.db_id) {
      return getOrInitEmailFormContext({
        type: 'replying_to',
        messageID: replyingTo.db_id,
        seed: props.formSeed,
      });
    }

    // If we only have the draft available, then we're most likely
    // editing a draft in a new thread with no other messages
    if (props.draft && props.draft.db_id) {
      return getOrInitEmailFormContext({
        type: 'draft',
        messageID: props.draft.db_id,
        seed: props.formSeed,
      });
    }

    // Fallback to empty state
    return getOrInitEmailFormContext();
  });
  const blockId = useBlockId();
  const emailLinksQuery = useEmailLinksQuery();
  const userEmail = useEmail();

  const toHeaderLinkId = useNonPrimaryEmailLinkIdHeader();
  const primaryLinkId = usePrimaryEmailLinkId();
  // The inbox this input acts in: the open thread's inbox, else the primary
  // inbox for a new message. Mutations send it as X-Email-Link-Id when it's a
  // non-primary inbox so the draft/send targets the right account.
  const activeLinkId = () =>
    form().selectedLinkId() ??
    ctx.thread()?.link_id ??
    props.draft?.link_id ??
    primaryLinkId() ??
    emailLinksQuery.data?.links[0]?.id;
  const headerLinkId = () => toHeaderLinkId(activeLinkId());
  // The address of the inbox this input sends from, for the "from" display.
  const activeInboxEmail = () =>
    emailLinksQuery.data?.links.find((l) => l.id === activeLinkId())
      ?.email_address ?? userEmail();

  // The full Link object for the sending inbox (for its saved signature and the
  // "add to replies & forwards" preference).
  const sendingLink = createMemo(() =>
    emailLinksQuery.data?.links.find((l) => l.id === activeLinkId())
  );
  const signature = useEmailSignature(activeLinkId);
  const emailSignaturesFlag = useFeatureFlag(ENABLE_EMAIL_SIGNATURES_FLAG, {
    enabledOverride: ENABLE_EMAIL_SIGNATURES_OVERRIDE,
  });
  // Whether this reply includes the signature. Defaults on, reset per reply,
  // and dismissable via the preview ✕.
  const [includeSignature, setIncludeSignature] = createSignal(true);
  // Signature HTML for the preview (and whether to show it): only for
  // replies/forwards, when the inbox's "add to replies & forwards" setting is on
  // and the user hasn't dismissed it. The backend does the actual injection on
  // send — this just mirrors when that will happen.
  const replySignatureHtml = (): string | undefined =>
    emailSignaturesFlag().enabled &&
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
  const [showExpandedRecipients, setShowExpandedRecipients] =
    createSignal<boolean>(false);
  const [isDragging, setIsDragging] = createSignal<boolean>();
  const [toRef, setToRef] = createSignal<HTMLInputElement>();
  const [ccRef, setCcRef] = createSignal<HTMLInputElement>();
  const [bccRef, setBccRef] = createSignal<HTMLInputElement>();
  const [showCc, setShowCc] = createSignal<boolean>();
  const [showBcc, setShowBcc] = createSignal<boolean>();
  const [recipientDragState, setRecipientDragState] = createSignal<{
    recipient: EmailRecipient;
    sourceField: 'to' | 'cc' | 'bcc';
  } | null>(null);
  // A pending undo-send restore that belongs to this thread (inline reply
  // remount case). It carries a just-undone send. Consumed below.
  const restoredSnapshot =
    undoReplySnapshot?.threadId === ctx.thread()?.db_id
      ? undoReplySnapshot
      : null;

  // The draft row this composer upserts into: the server draft when one
  // exists, else the one the undone send restores.
  const [savedDraftId, setSavedDraftId] = createSignal<
    ApiDraftOutputDbId | undefined
  >(props.draft?.db_id ?? restoredSnapshot?.draftId ?? undefined);

  const editorConfig = createConfiguredEmailMarkdownEditor({
    namespace: 'email-base-input-markdown',
    scrollContainer,
    onChange: (markdown) => handleChange(markdown),
    onUserMention: (mention) => handleUserMention(mention),
    onDocumentMention: (item) => {
      makeAttachmentPublic(item.id);
      scheduleDraftSave();
    },
    onPasteFilesAndDirs: (files, directories) => {
      handleFileFolderDrop(
        files,
        directories,
        createFilesReadyHandler(
          editor(),
          blockId,
          'email',
          undefined,
          (uploadedItemIds) => {
            uploadedItemIds.forEach((itemId) => {
              makeAttachmentPublic(itemId);
            });
            scheduleDraftSave();
          },
          { width: 542, height: 542 }
        )
      );
    },
  });

  const markdownHandle = editorConfig.buildHandle();
  const editor = () => markdownHandle.lexical;

  // Consume the undo-send snapshot so a later composer mount doesn't restore
  // it again. Use bodyHtml as initialHtml for the editor, restore attachments
  // on mount.
  if (restoredSnapshot) {
    undoReplySnapshot = null;
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
  restoreUndoCallback = (snapshot, draftId) => {
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
  };
  onCleanup(() => {
    restoreUndoCallback = null;
  });

  const initialHtml = () => restoredSnapshot?.bodyHtml ?? props.preloadedHtml;
  const handleEditorConnect = () => {
    const currentEditor = editor();
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
  let markDoneUndoHandle: UndoHandle | undefined;
  let pendingMarkDoneNavigationTargetId: string | undefined;

  // Everything that follows a successful unschedule: consume the send
  // snapshot, scrub the sent message from the thread cache, restore the
  // server-side draft and the composer, and reverse the send's mark-done.
  const restoreAfterUndoSend = async (
    draftId: string,
    linkId: string | undefined
  ) => {
    let snapshot: UndoReplySnapshot | null = null;
    if (undoSendSnapshot?.draftId === draftId) {
      snapshot = undoSendSnapshot;
      undoSendSnapshot = null;
    }

    // Remove the sent message from the thread cache so it disappears from
    // the list. Prefer the snapshot's threadId — captured at send time, it
    // survives navigation — while the context read covers snapshotless undos
    // in a still-mounted thread.
    const threadId = snapshot?.threadId ?? ctx.thread()?.db_id;
    if (threadId && !ENABLE_GRAPHQL_SOUP()) {
      queryClient.setQueryData(
        emailKeys.threadMessages(threadId).queryKey,
        (old: any) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              messages: page.messages.filter((m: any) => m.db_id !== draftId),
            })),
          };
        }
      );
      // Wipe the thread cache on unmount so the next visit fetches fresh
      // data (with the restored draft). Deferred to avoid Suspense DOM
      // detach while the thread is open.
      markThreadDraftSaved(threadId);
    }

    // Overwrite the server-side draft with the pre-send content before
    // anything loads it into a composer (thread revisit, refetch, next
    // session).
    if (snapshot) {
      await restoreDraftBodyAfterUndo(
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
    if (threadId && ENABLE_GRAPHQL_SOUP()) {
      void fetchAndCacheThread(threadId);
    }

    if (snapshot && restoreUndoCallback) {
      // A live BaseInput is mounted — restore after reactive updates from
      // setQueryData have settled (form may have re-keyed).
      const cb = restoreUndoCallback;
      setTimeout(() => cb(snapshot, draftId), 0);
    } else if (snapshot) {
      // No live component (e.g. inline reply was unmounted).
      // Stash for mount-time restore.
      undoReplySnapshot = snapshot;
      props.setShowReply?.(true);
    }

    // Reverse the mark-done this send triggered (restores the soup rows,
    // notification state, and unarchives), then refresh the thread's soup
    // item the same way a send does so inbox views show the restored draft.
    const doneHandle = markDoneUndoHandle;
    markDoneUndoHandle = undefined;
    if (doneHandle) {
      await doneHandle.undo({
        onError: () => toast.failure('Failed to restore thread to inbox'),
      });
    }
    if (threadId) {
      void refetchSoupEntity(threadId, 'emailThread');
    }
  };

  // linkId is the X-Email-Link-Id header value the send itself used, resolved
  // at send time. Undo can fire after navigation has disposed this component's
  // reactive state (mark-done navigates away).
  const undoSend = (draftId: string, linkId: string | undefined) =>
    runUndoSend({
      draftId,
      linkId,
      onUndone: () => restoreAfterUndoSend(draftId, linkId),
    });

  const sendMutation = useSendMessageMutation({
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
      const toastId = toast.success('Email sent', {
        actions: draftId
          ? [
              {
                label: 'Undo',
                icon: ArrowCounterClockwise,
                onClick: () => {
                  if (toastId != null) toast.dismiss(toastId);
                  void undoSend(draftId, sendLinkId);
                },
              },
            ]
          : undefined,
        duration: 5_000,
      });
      pendingMentions.forEach((mention) => {
        trackMention(blockId, 'document', mention.documentId);
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
      toast.failure('Failed to send email');
    },
  });

  const uploadAttachmentMutation = useUploadDraftAttachmentsMutation();
  const addForwardedAttachmentsMutation = useAddForwardedAttachmentsMutation();
  const saveDraftMutation = useSaveDraftMutation();
  const deleteDraftMutation = useDeleteDraftMutation();

  function refetchThreadMessages() {
    const threadId = ctx.thread()?.db_id;
    if (threadId) {
      markThreadDraftSaved(threadId);
    }
  }

  // Lexical setup after the quote append (decorator mounts, mutation flushes)
  // keeps flushing stale selections into the editor, yanking focus out of the
  // To field. While armed, bounce those grabs back to To; any deliberate user
  // interaction (pointer, Tab/Escape, focus leaving the composer) disarms it.
  let bounceEditorFocusGrabs = false;

  onMount(() => {
    const disarm = () => {
      bounceEditorFocusGrabs = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key === 'Escape') disarm();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!bounceEditorFocusGrabs) return;
      const target = e.target as Node;
      if (!composeContainerRef?.contains(target)) {
        disarm();
        return;
      }
      if (scrollContainer()?.contains(target)) {
        toRef()?.focus();
      }
    };
    document.addEventListener('pointerdown', disarm, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    onCleanup(() => {
      document.removeEventListener('pointerdown', disarm, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
    });
  });

  const focusForwardRecipients = () => {
    setShowExpandedRecipients(true);
    setTimeout(() => {
      if (toRef()) {
        bounceEditorFocusGrabs = true;
        toRef()?.focus();
      }
      // After the quoted thread is appended, keep the send bar in view
      bottomBarRef?.scrollIntoView({ block: 'nearest' });
    }, 100);
  };

  // Attach side-effect handlers on mount; they replay against current state
  onMount(() => {
    form().setOnDirty(() => {
      scheduleDraftSave();
    });

    form().setOnReplyTypeApplied((rt) => {
      setComposerExpanded(false);
      if (rt === 'forward') {
        setQuoteCollapsed(true);
        focusForwardRecipients();
      } else if (rt === 'reply' || rt === 'reply-all') {
        setTimeout(() => {
          editor()?.focus();
          bottomBarRef?.scrollIntoView({ block: 'nearest' });
        }, 100);
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
      Telemetry.error(
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
    if (sendMutation.isPending || pendingDeletion || pendingSend) {
      return;
    }
    const draftToSave = collectDraft();
    if (!draftToSave) {
      const draftId = savedDraftId();
      if (draftId) {
        await deleteDraftMutation.mutateAsync({
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
      Telemetry.error(new Error('Failed to save draft: thread not found'));
      return;
    }

    if (newMessage && currentThread) {
      Telemetry.error(
        new Error(
          'Failed to save draft: new message and current thread cannot be provided together'
        )
      );
      return;
    }

    const draftResponse = await saveDraftMutation.mutateAsync({
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
      // If the email draft saved successfully, we want to upload the
      // attachments as well. We should grab only the attachments that
      // haven't been uploaded yet
      const attachments = form()
        .attachments.list()
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

        // Assign the attachment ids to attachments for later use
        for (const attachment of uploaded.attachments) {
          form().attachments.assignAttachmentID(
            attachment.file,
            attachment.attachmentID
          );
        }
      }

      // Sync forwarded attachments
      const forwardedAttachments = form()
        .attachments.list()
        .filter((a) => a.type === 'forwarded') as Extract<
        DraftFormAttachment,
        { type: 'forwarded' }
      >[];

      if (forwardedAttachments.length) {
        await addForwardedAttachmentsMutation.mutateAsync({
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
    // edits server-side; a failure surfaces through the mutation's toast.
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
      focusForwardRecipients();
    }
    // Forwards focus the To field; focusing the editor would steal it back
    if (requestReplyType !== 'forward') {
      form().setShouldFocusInput(true);
    }
    ctx.replyRequest.clear();
  });

  const handleChipDragStart = (
    field: 'to' | 'cc' | 'bcc',
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
    targetField: 'to' | 'cc' | 'bcc',
    recipient: EmailRecipient,
    sourceField: 'to' | 'cc' | 'bcc'
  ) => {
    const sourceList = form().recipients()[sourceField];
    form().setRecipients(
      sourceField,
      sourceList.filter((r) => r.id !== recipient.id)
    );
    const targetList = form().recipients()[targetField];
    if (!targetList.some((r) => r.id === recipient.id)) {
      form().setRecipients(targetField, [...targetList, recipient]);
    }
    if (targetField === 'cc') setShowCc(true);
    if (targetField === 'bcc') setShowBcc(true);
    scheduleDraftSave();
  };

  const withDraftSave =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      scheduleDraftSave();
    };

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

  // Keep expanded recipients open while composing; collapse only when leaving
  // the composer or selecting outside its recipient popover.
  const expandedPointerDownHandler = (e: PointerEvent) => {
    if (showExpandedRecipients()) {
      const target = e.target as Node | null;
      if (!target) return;
      const combobox = document.querySelector('div[data-popper-positioner]');
      if (
        !composeContainerRef?.contains(target) &&
        !combobox?.contains(target)
      ) {
        setShowExpandedRecipients(false);
        setShowCc(form().recipients().cc.length > 0);
        setShowBcc(form().recipients().bcc.length > 0);
      }
    }
  };

  onMount(() => {
    document.addEventListener('pointerdown', expandedPointerDownHandler);

    onCleanup(() => {
      document.removeEventListener('pointerdown', expandedPointerDownHandler);
    });
  });

  const hasPaidAccess = useHasPaidAccess();

  // Set up hotkey scope for the compose message component
  const [attachComposeHotkeys, composeHotkeyScope] =
    useHotkeyDOMScope('compose-message');
  let composeContainerRef: HTMLDivElement | undefined;
  let bottomBarRef: HTMLDivElement | undefined;
  useTouchOutsideToDismissKeyboard(() => composeContainerRef);

  const sendEmail = async (markDone = false) => {
    if (sendMutation.isPending || uploadAttachmentMutation.isPending) return;

    const to = form().recipients().to.map(convertEmailRecipientToContactInfo);
    const cc = form().recipients().cc.map(convertEmailRecipientToContactInfo);
    const bcc = form().recipients().bcc.map(convertEmailRecipientToContactInfo);

    if ((to?.length ?? 0) + (cc?.length ?? 0) + (bcc?.length ?? 0) === 0) {
      toast.failure('Email failed to send. No recipients provided');
      return;
    }

    const currentThread = ctx.thread();
    const newMessage = props.newMessage ?? false;

    if (!currentThread && !newMessage) {
      Telemetry.error(new Error("Can't send email, no email thread found"));
      toast.failure('Email failed to send');
      return;
    }

    if (newMessage && currentThread) {
      toast.failure('Email failed to send');
      Telemetry.error('New message and thread cannot be provided together');
      return;
    }

    let linkId: string | undefined = currentThread?.link_id;
    if (newMessage || !linkId) {
      if (emailLinksQuery.isPending) {
        toast.alert('Loading email accounts...');
        return;
      }

      if (emailLinksQuery.isError) {
        toast.failure('Email failed to send: Could not load email accounts');
        Telemetry.error('Failed to load email links');
        return;
      }

      const linksData = emailLinksQuery.data;
      if (!linksData || linksData.links.length < 1) {
        toast.failure('Email failed to send: No email account connected');
        Telemetry.error('No links found');
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
    // Stored in undoSendSnapshot (not undoReplySnapshot) so it persists across
    // navigation but isn't mistakenly auto-restored on next mount.
    if (currentEditor) {
      const snapshotHtml = currentEditor.read(() =>
        $generateHtmlFromNodes(currentEditor)
      );
      const snapshotDraftId = savedDraftId();
      const snapshotThreadId = ctx.thread()?.db_id;
      if (snapshotDraftId && snapshotThreadId) {
        undoSendSnapshot = {
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
        };
      }
    }

    // Failsafe: don't send if a scheduled send time is set
    if (form().sendTime()) {
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

    sendMutation.mutate({
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
        await deleteDraftMutation.mutateAsync({
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
    });
  };

  onMount(() => {
    if (composeContainerRef) {
      attachComposeHotkeys(composeContainerRef);

      registerHotkey({
        hotkey: 'cmd+enter',
        scopeId: composeHotkeyScope,
        description: 'Send email',
        keyDownHandler: () => {
          if (form().sendTime()) return false;
          sendEmail();
          return true;
        },
        runWithInputFocused: true,
        hotkeyToken: TOKENS.email.send,
        displayPriority: 9,
      });

      registerHotkey({
        hotkey: 'shift+cmd+enter',
        scopeId: composeHotkeyScope,
        description: 'Send and mark done',
        keyDownHandler: () => {
          if (form().sendTime()) return false;
          sendEmail(true);
          return true;
        },
        runWithInputFocused: true,
        hotkeyToken: TOKENS.email.sendAndMarkDone,
        displayPriority: 10,
      });

      registerHotkey({
        hotkey: 'arrowup',
        scopeId: composeHotkeyScope,
        description: 'Select last message',
        runWithInputFocused: true,
        condition: () => {
          const ed = editor();
          if (!ed) return false;
          const rootEl = ed.getRootElement();
          if (!rootEl || !rootEl.contains(document.activeElement)) return false;
          return ed.read(() => {
            const text = $getRoot().getTextContent();
            return text.trim().length === 0;
          });
        },
        keyDownHandler: () => {
          const messages = ctx.messages.list();
          if (!messages?.length) return false;
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg?.db_id) return false;
          editor()?.blur();
          ctx.messages.setFocused(lastMsg.db_id);
          const msgEl = document.querySelector(
            `[data-message-body-id="${lastMsg.db_id}"]`
          ) as HTMLElement | null;
          const focusable = msgEl?.closest(
            '[tabindex="0"]'
          ) as HTMLElement | null;
          focusable?.focus();
          return true;
        },
        hotkeyToken: TOKENS.email.previousMessage,
      });

      registerHotkey({
        hotkey: 'escape',
        scopeId: composeHotkeyScope,
        description: 'Close reply',
        keyDownHandler: () => {
          const draft = collectDraft();
          const isEmpty = draft === null;

          if (isEmpty) {
            // Delete draft and close reply
            deleteDraftAndReset();
          } else {
            // Move focus back to the message
            const focusedId = ctx.messages.focusedID();
            if (focusedId) {
              const messageEl = document.querySelector(
                `[data-message-body-id="${focusedId}"]`
              ) as HTMLElement | null;
              messageEl?.focus();
            }
          }
          return true;
        },
        runWithInputFocused: true,
        hotkeyToken: TOKENS.email.cancelReply,
        displayPriority: 8,
      });
    }
  });

  // Focus when external shouldFocus signal is set to true. The builder creates
  // the Lexical editor immediately; requestAnimationFrame waits for the root to
  // connect before focusing.
  createEffect(() => {
    if (!form().shouldFocusInput()) return;
    if (isTouchDevice()) {
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
    requestAnimationFrame(() => {
      ed.focus();
      form().setShouldFocusInput(false);
    });
  });

  const handleAddAttachments = (files: File[]) => {
    const currentAttachments = form().attachments.list();

    const attachmentsToAddByteSize = files.reduce((sum, f) => sum + f.size, 0);

    if (attachmentsToAddByteSize >= MAX_ATTACHMENTS_BYTES_SIZE) {
      toast.failure(`${plural('Attachment', files.length)} exceed 18MB`);
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
      toast.failure("Can't add more attachments", {
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

  const removeAttachmentMutation = useRemoveDraftAttachmentMutation();
  const removeForwardedAttachmentMutation =
    useRemoveForwardedAttachmentMutation();

  const handleRemoveAttachment = (attachment: DraftFormAttachment) => {
    if (attachment.type === 'local') {
      form().attachments.removeByFile(attachment.file);
    } else if (attachment.type === 'forwarded') {
      form().attachments.removeForwarded(attachment.attachmentID);
    } else {
      form().attachments.removeByID(attachment.attachmentID);
    }

    const currentDraftID = savedDraftId();

    if (!currentDraftID || !attachment.attachmentID) return;

    if (attachment.type === 'forwarded') {
      removeForwardedAttachmentMutation.mutate({
        draftID: currentDraftID,
        attachmentID: attachment.attachmentID,
        linkId: headerLinkId(),
      });
    } else {
      removeAttachmentMutation.mutate({
        draftID: currentDraftID,
        attachmentID: attachment.attachmentID,
        linkId: headerLinkId(),
      });
    }
  };

  const unscheduleMessageMutation = useUnscheduleMessageMutation({
    onSuccess: () => {
      toast.success('Email unscheduled');
    },
    onError: () => {
      toast.failure('Failed to unschedule email');
    },
  });

  const handleSendTimeChange = async (date: Date | null) => {
    const currentSendTime = form().sendTime();
    const currentDraft = savedDraftId();

    // If we unset the send time, we need to unschedule the message
    if (!date && currentSendTime && currentDraft) {
      unscheduleMessageMutation.mutate({
        draftID: currentDraft,
        linkId: headerLinkId(),
      });
      form().setSendTime(date);
      return;
    }

    form().setSendTime(date);

    if (date) {
      // Ensure draft is saved before scheduling
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

      // Mark the thread as done
      const threadID = ctx.thread()?.db_id;
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
    const r = form().recipients();
    return r.to.length + r.cc.length + r.bcc.length;
  };
  createEffect(
    on(
      totalRecipientCount,
      (count) => {
        if (count === 0 && form().sendTime()) {
          handleSendTimeChange(null);
        }
      },
      { defer: true }
    )
  );

  const hasBodyText = () => bodyMacro().trim().length > 0;
  const isMobileDrawer = () => props.mobileDrawer !== undefined;
  const composePortalScope = () => (isMobileDrawer() ? 'local' : undefined);
  const sendActionHidden = () =>
    isTouchDevice() &&
    !hasBodyText() &&
    // Forwards carry the quoted thread as content, so send is available without typing anything.
    effectiveReplyType() !== 'forward';
  const sendActionDisabled = () =>
    uploadAttachmentMutation.isPending ||
    sendMutation.isPending ||
    !!form().sendTime();
  const scheduleSendDisabled = () =>
    form().recipients().to.length === 0 &&
    form().recipients().cc.length === 0 &&
    form().recipients().bcc.length === 0;
  const scrollAreaSignatureHtml = () =>
    isMobileDrawer() ? replySignatureHtml() : undefined;
  const footerSignatureHtml = () =>
    isMobileDrawer() ? undefined : replySignatureHtml();
  const replyingToSummary = () => {
    const recipients = [
      ...form().recipients().to,
      ...form().recipients().cc,
      ...form().recipients().bcc,
    ];
    const firstRecipient = recipients[0];
    const action =
      effectiveReplyType() === 'forward' ? 'Forwarding' : 'Replying to';
    if (!firstRecipient) return action;

    const remainingCount = recipients.length - 1;
    const suffix = remainingCount > 0 ? ` + ${remainingCount}` : '';
    return `${action} ${getRecipientDisplayName(firstRecipient)}${suffix}`;
  };
  const mobileRecipientSelectorClass =
    'min-w-0 flex-1 bg-transparent rounded-none! [&_input]:ml-0! [&_input]:min-w-0! [&_input]:text-[17px] [&_input]:leading-6 [&_input]:text-ink [&_input]:placeholder:text-ink-placeholder';
  const mobileDrawerRowClass =
    'w-full gap-2 min-h-16 border-b border-edge-muted/70 focus-within:border-accent';
  const mobileDrawerCcBccOpen = () =>
    !!showCc() ||
    !!showBcc() ||
    form().recipients().cc.length > 0 ||
    form().recipients().bcc.length > 0;
  const toggleMobileDrawerCcBcc = () => {
    const next = !mobileDrawerCcBccOpen();
    setShowCc(next);
    setShowBcc(next);
  };

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

  const AttachmentsRow = (rowProps?: { class?: string }) => (
    <Show when={form().attachments.list().length > 0}>
      <div
        class={cn(
          'ph-no-capture shrink-0 flex gap-1 flex-wrap w-full py-2',
          rowProps?.class
        )}
      >
        <For each={form().attachments.list()}>
          {(attachment) => (
            <Switch>
              <Match when={attachment.type === 'local' && attachment}>
                {(attachment) => (
                  <EmailAttachmentPill
                    attachment={{
                      fileName: attachment().file.name,
                      mimeType: attachment().file.type,
                    }}
                    removable
                    onRemove={() => handleRemoveAttachment(attachment())}
                  />
                )}
              </Match>
              <Match when={attachment.type === 'remote' && attachment}>
                {(attachment) => (
                  <EmailAttachmentPill
                    attachment={{
                      fileName: attachment().fileName,
                      mimeType: attachment().contentType,
                    }}
                    removable
                    onRemove={() => handleRemoveAttachment(attachment())}
                  />
                )}
              </Match>
              <Match when={attachment.type === 'forwarded' && attachment}>
                {(attachment) => (
                  <EmailAttachmentPill
                    attachment={{
                      fileName: attachment().fileName,
                      mimeType: attachment().mimeType,
                    }}
                    removable
                    onRemove={() => handleRemoveAttachment(attachment())}
                  />
                )}
              </Match>
            </Switch>
          )}
        </For>
      </div>
    </Show>
  );

  const AttachButton = (buttonProps?: {
    variant?: 'ghost' | 'outline';
    class?: string;
  }) => (
    <Button
      ref={(el) =>
        fileSelector(el, () => ({
          multiple: true,
          onSelect: handleAddAttachments,
        }))
      }
      size="icon-sm"
      variant={buttonProps?.variant}
      class={buttonProps?.class}
      tooltip="Attach"
    >
      <Paperclip />
    </Button>
  );

  return (
    <Surface
      class={cn(
        'relative flex flex-col flex-1 max-w-full min-h-0',
        isMobileDrawer() && 'min-h-full overflow-y-scroll overscroll-y-none',
        props.unframed ? 'rounded-lg' : 'rounded-xl'
      )}
      style={props.unframed ? { 'background-color': 'transparent' } : undefined}
      hideBorder={props.unframed}
      ref={(el) => {
        composeContainerRef = el;
      }}
      depth={2}
      solid
    >
      <Show when={isMobileDrawer()}>
        <Layer depth={0}>
          <div
            data-corvu-no-drag=""
            class="sticky top-0 right-0 left-0 z-10 shrink-0 p-3 pt-0 flex items-center justify-between bg-surface"
          >
            <div class="flex items-center gap-1 min-w-0">
              <Button
                variant="ghost"
                size="icon-sm"
                class="rounded-full border border-edge-muted/70 bg-transparent"
                tooltip={savedDraftId() ? 'Delete draft' : 'Discard draft'}
                onClick={deleteDraftAndReset}
              >
                <Trash class="size-4" />
              </Button>
            </div>
            <div class="ml-auto flex items-center gap-1">
              <AttachButton
                variant="ghost"
                class="rounded-full border border-edge-muted/70 bg-transparent"
              />
              <SendButton
                disabled={sendActionDisabled() || sendActionHidden()}
                pending={sendMutation.isPending}
                onClick={() => sendEmail()}
              />
            </div>
          </div>
        </Layer>
      </Show>
      <Show
        when={isMobileDrawer()}
        fallback={
          <>
            <div
              class={cn(
                'relative mb-4 min-w-0 text-sm text-ink-muted flex items-center gap-2 wrap',
                !showExpandedRecipients() && 'py-3'
              )}
            >
              <Show
                when={showExpandedRecipients()}
                fallback={
                  <div class="flex flex-1 min-w-0">
                    <button
                      type="button"
                      class="flex w-full min-w-0 items-center gap-2 text-sm text-ink-muted"
                      onClick={() => setShowExpandedRecipients(true)}
                    >
                      <span class="block min-w-0 flex-1 truncate text-left">
                        {replyingToSummary()}
                      </span>
                      <CaretRight class="size-3 shrink-0 text-ink-extra-muted" />
                    </button>
                  </div>
                }
              >
                <div class="min-w-0 w-full">
                  <div class="flex items-center gap-2 min-w-0 border-b border-edge-muted">
                    <div class="flex items-center gap-2 min-w-0 flex-1 py-3">
                      <div class="w-14 shrink-0 text-sm text-ink-placeholder">
                        From
                      </div>
                      <FromInboxSelector
                        pill
                        class="min-w-0"
                        links={emailLinksQuery.data?.links ?? []}
                        activeLinkId={activeLinkId()}
                        onSelect={persistDraftOnSenderSwitch}
                        portalScope={composePortalScope()}
                      />
                    </div>
                    <div class="flex items-center ml-auto shrink-0">
                      <Show when={!showCc()}>
                        <Button
                          size="sm"
                          class="rounded-lg"
                          onClick={() => {
                            setShowCc(true);
                            queueMicrotask(() => ccRef()?.focus());
                          }}
                        >
                          Cc
                        </Button>
                      </Show>
                      <Show when={!showBcc()}>
                        <Button
                          size="sm"
                          class="rounded-lg"
                          onClick={() => {
                            setShowBcc(true);
                            queueMicrotask(() => bccRef()?.focus());
                          }}
                        >
                          Bcc
                        </Button>
                      </Show>
                    </div>
                  </div>

                  <RecipientDropRow
                    field="to"
                    class="w-full gap-2 py-3 border-b border-edge-muted focus-within:border-accent items-center"
                    dragState={recipientDragState}
                    onDrop={handleRecipientDrop}
                  >
                    <div class="w-14 shrink-0 text-sm text-ink-placeholder">
                      To
                    </div>
                    <RecipientSelector<EmailRecipient['kind']>
                      openOnFocus={false}
                      class="min-w-0 bg-transparent rounded-none! [&_input]:ml-0!"
                      inputRef={setToRef}
                      options={ctx.recipientOptions}
                      selfEmail={activeInboxEmail()}
                      selectedOptions={form().recipients().to}
                      setSelectedOptions={withDraftSave((v) =>
                        form().setRecipients('to', v)
                      )}
                      triggerMode="input"
                      hideBorder
                      noPadding
                      onChipDragStart={(option, e) =>
                        handleChipDragStart('to', option, e)
                      }
                      onChipDragEnd={handleChipDragEnd}
                      hideMenuOnEscape
                    />
                  </RecipientDropRow>
                  {/* Expanded CC */}
                  <Show when={showCc() || form().recipients().cc.length > 0}>
                    <RecipientDropRow
                      field="cc"
                      class="w-full gap-2 py-3 border-b border-edge-muted focus-within:border-accent items-center"
                      dragState={recipientDragState}
                      onDrop={handleRecipientDrop}
                    >
                      <div class="w-14 shrink-0 text-sm text-ink-placeholder">
                        Cc
                      </div>
                      <RecipientSelector<EmailRecipient['kind']>
                        openOnFocus={false}
                        class="min-w-0 bg-transparent rounded-none! [&_input]:ml-0!"
                        inputRef={setCcRef}
                        options={ctx.recipientOptions}
                        selfEmail={activeInboxEmail()}
                        selectedOptions={form().recipients().cc}
                        setSelectedOptions={withDraftSave((v) =>
                          form().setRecipients('cc', v)
                        )}
                        triggerMode="input"
                        hideBorder
                        noPadding
                        onChipDragStart={(option, e) =>
                          handleChipDragStart('cc', option, e)
                        }
                        onChipDragEnd={handleChipDragEnd}
                        hideMenuOnEscape
                      />
                    </RecipientDropRow>
                  </Show>
                  {/* Expanded BCC */}
                  <Show when={showBcc() || form().recipients().bcc.length > 0}>
                    <RecipientDropRow
                      field="bcc"
                      class="w-full gap-2 py-3 border-b border-edge-muted focus-within:border-accent items-center"
                      dragState={recipientDragState}
                      onDrop={handleRecipientDrop}
                    >
                      <div class="w-14 shrink-0 text-sm text-ink-placeholder">
                        Bcc
                      </div>
                      <RecipientSelector<EmailRecipient['kind']>
                        openOnFocus={false}
                        class="min-w-0 bg-transparent rounded-none! [&_input]:ml-0!"
                        inputRef={setBccRef}
                        options={ctx.recipientOptions}
                        selfEmail={activeInboxEmail()}
                        selectedOptions={form().recipients().bcc}
                        setSelectedOptions={withDraftSave((v) =>
                          form().setRecipients('bcc', v)
                        )}
                        triggerMode="input"
                        hideBorder
                        noPadding
                        onChipDragStart={(option, e) =>
                          handleChipDragStart('bcc', option, e)
                        }
                        onChipDragEnd={handleChipDragEnd}
                        hideMenuOnEscape
                      />
                    </RecipientDropRow>
                  </Show>
                </div>
              </Show>
            </div>
            <div
              class={cn(
                'flex-row items-center',
                props.isEditingExisting || props.newMessage ? 'flex' : 'hidden'
              )}
            >
              <div class="text-sm min-w-16 pl-4">Subject</div>
              <input
                type="text"
                class="flex-1 text-sm bg-transparent outline-none border-0 px-3 py-1"
                value={form().subject()}
                onInput={(e) => {
                  form().setSubject(e.currentTarget.value);
                  scheduleDraftSave();
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return;
                  e.preventDefault();
                  e.currentTarget.blur();
                }}
                placeholder="Subject"
              />
            </div>
          </>
        }
      >
        <div class="pt-1 relative min-w-0 leading-6 text-ink-muted px-5">
          <RecipientDropRow
            field="to"
            class={cn(mobileDrawerRowClass, 'items-center py-2')}
            dragState={recipientDragState}
            onDrop={handleRecipientDrop}
          >
            <div class="shrink-0 text-ink-placeholder">To:</div>
            <RecipientSelector<EmailRecipient['kind']>
              openOnFocus={false}
              class={mobileRecipientSelectorClass}
              inputRef={setToRef}
              options={ctx.recipientOptions}
              selfEmail={activeInboxEmail()}
              selectedOptions={form().recipients().to}
              setSelectedOptions={withDraftSave((v) =>
                form().setRecipients('to', v)
              )}
              triggerMode="input"
              portalScope={composePortalScope()}
              hideBorder
              noPadding
              onChipDragStart={(option, e) =>
                handleChipDragStart('to', option, e)
              }
              onChipDragEnd={handleChipDragEnd}
              hideMenuOnEscape
            />
            <Button
              variant="ghost"
              size="icon-sm"
              class="shrink-0 rounded-full bg-transparent text-ink-placeholder"
              tooltip={mobileDrawerCcBccOpen() ? 'Hide Cc/Bcc' : 'Show Cc/Bcc'}
              aria-expanded={mobileDrawerCcBccOpen()}
              onClick={toggleMobileDrawerCcBcc}
            >
              <Show
                when={mobileDrawerCcBccOpen()}
                fallback={<CaretRight class="size-4" />}
              >
                <ChevronDown class="size-4" />
              </Show>
            </Button>
          </RecipientDropRow>

          <Show when={showCc() || form().recipients().cc.length > 0}>
            <RecipientDropRow
              field="cc"
              class={cn(mobileDrawerRowClass, 'items-center py-2')}
              dragState={recipientDragState}
              onDrop={handleRecipientDrop}
            >
              <div class="shrink-0 text-ink-placeholder">Cc:</div>
              <RecipientSelector<EmailRecipient['kind']>
                openOnFocus={false}
                class={mobileRecipientSelectorClass}
                inputRef={setCcRef}
                options={ctx.recipientOptions}
                selfEmail={activeInboxEmail()}
                selectedOptions={form().recipients().cc}
                setSelectedOptions={withDraftSave((v) =>
                  form().setRecipients('cc', v)
                )}
                triggerMode="input"
                portalScope={composePortalScope()}
                hideBorder
                noPadding
                onChipDragStart={(option, e) =>
                  handleChipDragStart('cc', option, e)
                }
                onChipDragEnd={handleChipDragEnd}
                hideMenuOnEscape
              />
            </RecipientDropRow>
          </Show>

          <Show when={showBcc() || form().recipients().bcc.length > 0}>
            <RecipientDropRow
              field="bcc"
              class={cn(mobileDrawerRowClass, 'items-center py-2')}
              dragState={recipientDragState}
              onDrop={handleRecipientDrop}
            >
              <div class="shrink-0 text-ink-placeholder">Bcc:</div>
              <RecipientSelector<EmailRecipient['kind']>
                openOnFocus={false}
                class={mobileRecipientSelectorClass}
                inputRef={setBccRef}
                options={ctx.recipientOptions}
                selfEmail={activeInboxEmail()}
                selectedOptions={form().recipients().bcc}
                setSelectedOptions={withDraftSave((v) =>
                  form().setRecipients('bcc', v)
                )}
                triggerMode="input"
                portalScope={composePortalScope()}
                hideBorder
                noPadding
                onChipDragStart={(option, e) =>
                  handleChipDragStart('bcc', option, e)
                }
                onChipDragEnd={handleChipDragEnd}
                hideMenuOnEscape
              />
            </RecipientDropRow>
          </Show>

          <div
            class="min-h-14 border-b border-edge-muted/70 flex items-center min-w-0"
            data-corvu-no-drag=""
          >
            <span class="shrink-0 text-ink-placeholder">From:&nbsp;</span>
            <FromInboxSelector
              compact
              class="min-w-0 truncate text-ink-muted"
              links={emailLinksQuery.data?.links ?? []}
              activeLinkId={activeLinkId()}
              onSelect={persistDraftOnSenderSwitch}
              portalScope={composePortalScope()}
            />
          </div>

          <div class="min-h-14 border-b border-edge-muted/70 flex items-center">
            <input
              type="text"
              class="w-full bg-transparent outline-none border-0 text-[17px] leading-6 text-ink placeholder:text-ink-placeholder"
              value={form().subject()}
              onInput={(e) => {
                form().setSubject(e.currentTarget.value);
                scheduleDraftSave();
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.currentTarget.blur();
              }}
              placeholder="Subject:"
            />
          </div>
        </div>
      </Show>
      <div
        class={cn(
          isMobileDrawer()
            ? 'relative flex-1 flex flex-col'
            : 'size-full flex flex-col min-h-0',
          showExpandedRecipients() && 'mt-4'
        )}
      >
        <div
          ref={setScrollContainer}
          class={cn(
            'relative min-h-8 w-full flex flex-col placeholder:text-ink-placeholder placeholder:opacity-50 px-0 py-1',
            isMobileDrawer()
              ? 'max-h-none flex-1 overflow-visible px-5 pt-6 pb-4'
              : cn(
                  'overflow-y-auto mobile:max-h-[calc(32*var(--dvh,1dvh))]',
                  composerExpanded()
                    ? // Cap to the thread viewport (minus composer chrome) so the
                      // recipients row and send bar stay on screen together
                      'max-h-[min(calc(60*var(--dvh,1dvh)),calc(var(--thread-height,9999px)-14rem))]'
                    : 'max-h-56'
                )
          )}
          onScroll={(e) => {
            if (composerExpanded() || e.currentTarget.scrollTop <= 0) return;
            setComposerExpanded(true);
            // Keep the send bar pinned while the box grows
            requestAnimationFrame(() => {
              bottomBarRef?.scrollIntoView({ block: 'nearest' });
            });
          }}
          onclick={() => {
            editor()?.focus();
          }}
          use:fileFolderDrop={{
            onDragStart: (valid) => setIsDragging(valid),
            onDragEnd: () => setIsDragging(false),
            onDrop: (fileEntries, folderEntries, e) => {
              const editor_ = editor();
              if (!editor_ || !e) return;
              handleFileFolderDrop(
                fileEntries,
                folderEntries,
                createFilesReadyHandler(
                  editor_,
                  blockId,
                  'email',
                  () => getDragDropPosition(editor_, e, true),
                  (uploadedItemIds) => {
                    setIsDragging(false);
                    uploadedItemIds.forEach((itemId) => {
                      makeAttachmentPublic(itemId);
                    });
                    scheduleDraftSave();
                  },
                  { width: 542, height: 542 }
                )
              );
            },
          }}
        >
          <div
            class={cn('absolute size-full inset-0', !isDragging() && 'hidden')}
          >
            <FileDropOverlay>Drop file(s) to attach</FileDropOverlay>
          </div>
          <MarkdownShell
            config={editorConfig}
            class={cn(
              'ph-no-capture cursor-text wrap-break-word text-ink h-auto overflow-visible',
              isMobileDrawer() ? 'text-[17px] leading-6' : 'text-sm',
              // Quoted thread collapses behind the "⋯" pill below
              // (rule lives in LexicalMarkdown/styles.css — Tailwind arbitrary
              // variants turn the underscore in .macro_quote into a space)
              quoteCollapsed() && 'quote-collapsed',
              isDragging() && 'blur'
            )}
            disabled={sendMutation.isPending}
            initialValue={initialHtml() ? undefined : props.preloadedBody}
            placeholder={
              isMobileDrawer()
                ? 'Use `@` to reference files'
                : 'Reply — @mention to share or cc people'
            }
            portalScope={isMobileDrawer() ? 'local' : 'split'}
            refFn={(el) => props.markdownDomRef?.(el)}
            onConnect={handleEditorConnect}
          />
          <Show when={!hasPaidAccess()}>
            <div class="text-ink/50 mt-[1lh]" data-watermark>
              <MacroSignatureButton />
            </div>
          </Show>
          <Show when={isMobileDrawer()}>
            <AttachmentsRow />
          </Show>
          <Show when={scrollAreaSignatureHtml()}>
            {(html) => (
              <SignaturePreview
                html={html()}
                onDismiss={() => {
                  // Dismissal is composer-local state worth keeping — latch
                  // the seed so a draft upgrade can't remount it away.
                  props.onEngaged?.();
                  setIncludeSignature(false);
                }}
              />
            )}
          </Show>
        </div>
        {/* Quoted-text controls live below the scroll area so they stay
            anchored to the composer bottom instead of scrolling with (and
            floating over) tall content. */}
        <Show when={form().replyAppended() && quoteCollapsed()}>
          <div class="shrink-0 flex items-center pt-1" data-corvu-no-drag="">
            <Button
              variant="ghost"
              size="icon-sm"
              class="rounded-md text-ink-extra-muted hover:text-ink-muted hover:bg-active"
              tooltip="Show quoted text"
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                setQuoteCollapsed(false);
                setComposerExpanded(true);
              }}
            >
              <DotsThree />
            </Button>
          </div>
        </Show>
        <Show
          when={
            props.replyingTo() &&
            // The collapse pill above already covers this state
            !(form().replyAppended() && quoteCollapsed())
          }
        >
          <div
            class="shrink-0 pt-1"
            data-corvu-no-drag=""
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip
              label={
                form().replyAppended() ? 'Hide quoted text' : 'Show quoted text'
              }
            >
              <KToggleButton
                as={Button}
                variant="ghost"
                size="icon-sm"
                class="size-5 rounded bg-transparent p-0 text-ink-extra-muted hover:text-ink-muted [&_:where(svg)]:size-5"
                pressed={form().replyAppended()}
                onChange={toggleQuotedText}
              >
                <DotsThree />
              </KToggleButton>
            </Tooltip>
          </div>
        </Show>
        <Show when={!isMobileDrawer()}>
          {/* Below the scroll area so quoted email content can never overlap it */}
          <AttachmentsRow class="px-4" />
          <Show when={footerSignatureHtml()}>
            {(html) => (
              <SignaturePreview
                html={html()}
                onDismiss={() => {
                  // Dismissal is composer-local state worth keeping — latch
                  // the seed so a draft upgrade can't remount it away.
                  props.onEngaged?.();
                  setIncludeSignature(false);
                }}
              />
            )}
          </Show>
          {/* No fixed height: the send button (size-7.5) is taller than the icon
              buttons, and a fixed h-9 minus the vertical padding left it 4px short
              — with items-end it bled upward over the signature bar above. */}
          <div
            ref={bottomBarRef}
            class="shrink-0 flex flex-row w-full justify-between items-end space-x-2 px-0 pb-0 pt-1.5"
          >
            <div class="flex flex-row items-center gap-1">
              <div class="relative flex">
                <AttachButton />
              </div>

              <Button
                onclick={deleteDraftAndReset}
                tooltip={savedDraftId() ? 'Delete draft' : 'Discard'}
                size="icon-sm"
              >
                <Trash />
              </Button>
            </div>

            <div class="flex flex-row items-center gap-1">
              <Show when={ENABLE_EMAIL_SCHEDULED_SEND && !sendActionHidden()}>
                <EmailDateSelector
                  sendTime={form().sendTime() ?? null}
                  onSendTimeChange={handleSendTimeChange}
                  disabled={scheduleSendDisabled()}
                  disablePortal={isTouchDevice()}
                />
              </Show>
              <SendButton
                disabled={
                  uploadAttachmentMutation.isPending ||
                  sendMutation.isPending ||
                  !!form().sendTime()
                }
                pending={sendMutation.isPending}
                hidden={sendActionHidden()}
                onClick={() => sendEmail()}
              />
            </div>
          </div>
        </Show>
      </div>
    </Surface>
  );
}
