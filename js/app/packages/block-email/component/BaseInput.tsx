import { cn } from '@ui/utils/classname';
import { fileSelector } from '@core/directive/fileSelector';
import { FormatButtons } from '@channel/Input/FormatButtons';
import {
  applyInlineFormat,
  applyNodeFormat,
} from '@channel/Input/utils/formatting';
import { MacroSignatureButton } from '@block-email/component/MacroSignatureButton';
import { convertContactInfoToEmailRecipient } from '@block-email/util/recipientConversion';
import {
  MACRO_EMAIL_SIGNATURE,
  MAX_ATTACHMENTS_BYTES_SIZE,
} from '@block-email/constants';
import { useHasPaidAccess } from '@core/auth';
import { useBlockId } from '@core/block';
import { FileDropOverlay } from '@core/component/FileDropOverlay';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import {
  createFilesReadyHandler,
  getDragDropPosition,
} from '@core/component/LexicalMarkdown/utils/fileUploadUtils';
import type { UserMentionRecord } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { toast } from '@core/component/Toast/Toast';
import { Tooltip } from '@core/component/Tooltip';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { observedSize } from '@core/directive/observedSize';
import { TOKENS } from '@core/hotkey/tokens';
import { trackMention } from '@core/signal/mention';
import { tryMacroId, useDisplayName } from '@core/user';
import { handleFileFolderDrop } from '@core/util/upload';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import ArrowUp from '@icon/bold/arrow-up-bold.svg';
import Spinner from '@icon/bold/spinner-gap-bold.svg';
import ReplyAll from '@icon/regular/arrow-bend-double-up-left.svg';
import Reply from '@icon/regular/arrow-bend-up-left.svg';
import Forward from '@icon/regular/arrow-bend-up-right.svg';
import Paperclip from '@icon/regular/paperclip.svg';
import Quotes from '@icon/regular/quotes.svg';
import TextAa from '@icon/regular/text-aa.svg';
import Trash from '@icon/regular/trash.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { ToggleButton as KToggleButton } from '@kobalte/core/toggle-button';
import {
  $appendWatermarkNodeToLast,
  $removeAllWatermarkNodes,
} from '@lexical-core';
import { $generateHtmlFromNodes } from '@lexical/html';
import { setEditorStateFromHtml } from '@core/component/LexicalMarkdown/utils';
import { logger } from '@observability';
import { useEmailLinksQuery } from '@queries/email/link';
import { invalidateSoupEntity } from '@queries/soup/cache';
import { emailClient } from '@service-email/client';
import {
  useSendMessageMutation,
  useUnscheduleMessageMutation,
} from '@queries/email/thread';
import type {
  ApiDraftOutputDbId,
  ApiMessage,
} from '@service-email/generated/schemas';
import { useEmail, useUserId } from '@core/context/user';
import { Button } from '@ui/components/Button';
import {
  defaultSelectionData,
  lazyRegister,
  type NodeTransformType,
  type SelectionData,
} from 'core/component/LexicalMarkdown/plugins';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import { $getRoot, type LexicalEditor } from 'lexical';
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
import { createStore } from 'solid-js/store';
import {
  useDeleteDraftMutation,
  useSaveDraftMutation,
} from '@queries/email/draft';
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
  type EmailRecipient,
  markThreadDraftSaved,
  useEmailContext,
} from './EmailContext';
import { getOrInitEmailFormContext } from './EmailFormContext';
import {
  useAddForwardedAttachmentsMutation,
  useRemoveDraftAttachmentMutation,
  useRemoveForwardedAttachmentMutation,
  useUploadDraftAttachmentsMutation,
} from '@queries/email/attachment';
import { EmailAttachmentPill } from '@block-email/component/AttachmentPill';
import type { DraftFormAttachment } from '@block-email/component/createEmailFormState';
import { plural } from '@core/util/string';
import { EmailDateSelector } from '@block-email/component/email-date-selector';
import { isMobile } from '@core/mobile/isMobile';
import { queryClient } from '@queries/client';
import { emailKeys } from '@queries/email/keys';
import { ENABLE_EMAIL_SCHEDULED_SEND } from '@core/constant/featureFlags';
import ChevronDown from '@icon/regular/caret-down.svg';

false && fileFolderDrop;
false && fileSelector;
false && observedSize;

const getRecipientDisplayName = (item: EmailRecipient): string => {
  switch (item.kind) {
    case 'user':
    case 'contact':
      return getFirstName(item.data.name) || item.data.email;
    case 'custom':
      return item.data.email;
  }
};

// Shared constants for recipient display - used in both measurement and rendering
const MAX_VISIBLE_RECIPIENTS = 3;
const RECIPIENT_SEPARATOR = ',\u00A0'; // comma + non-breaking space
const MORE_SUFFIX_TEMPLATE = '+99 more'; // worst-case for measurement

// Build the display text for a recipient (used for measurement)
const buildRecipientText = (
  prefix: string,
  displayName: string,
  showSeparator: boolean
): string => {
  return prefix + displayName + (showSeparator ? RECIPIENT_SEPARATOR : '');
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
      class={cn('flex flex-row items-center', props.class)}
      classList={{ 'bg-accent/10': isDragOver() }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {props.children}
    </div>
  );
}

function TruncatedRecipientList(props: {
  toRecipients: EmailRecipient[];
  ccRecipients: EmailRecipient[];
  bccRecipients: EmailRecipient[];
  onClick: () => void;
}) {
  let measureRef: HTMLSpanElement | undefined;

  const [visibleCount, setVisibleCount] = createSignal<number>(0);
  const [containerRect, setContainerRect] = createSignal<DOMRect | undefined>();

  // Combine all recipients into a flat list with group info for display
  const allRecipients = createMemo(() => {
    const result: { recipient: EmailRecipient; prefix: string }[] = [];

    // Add "to" recipients
    props.toRecipients.forEach((r, i) => {
      const prefix = i === 0 ? 'to ' : '';
      result.push({ recipient: r, prefix });
    });

    // Add "cc" recipients (show "cc" prefix only if no "to" recipients)
    props.ccRecipients.forEach((r, i) => {
      const prefix = i === 0 && props.toRecipients.length === 0 ? 'cc ' : '';
      result.push({ recipient: r, prefix });
    });

    // Add "bcc" recipients with label
    props.bccRecipients.forEach((r, i) => {
      const prefix = i === 0 ? 'bcc ' : '';
      result.push({ recipient: r, prefix });
    });

    return result;
  });

  const totalCount = createMemo(() => allRecipients().length);

  // Measure text width using hidden element
  const measureText = (text: string): number => {
    if (!measureRef) return 0;
    measureRef.textContent = text;
    return measureRef.offsetWidth;
  };

  // Calculate how many recipients fit in the container
  const calculateVisibleCount = () => {
    const width = containerRect()?.width ?? 0;
    if (width <= 0 || !measureRef) return;

    const recipients = allRecipients();
    if (recipients.length === 0) {
      setVisibleCount(0);
      return;
    }

    // Reserve space for "+N more" suffix
    const moreTextWidth = measureText(MORE_SUFFIX_TEMPLATE);
    const availableWidth = width - moreTextWidth;

    let usedWidth = 0;
    let count = 0;

    const maxRecipients = Math.min(recipients.length, MAX_VISIBLE_RECIPIENTS);
    for (let i = 0; i < maxRecipients; i++) {
      const { recipient, prefix } = recipients[i];
      const displayName = getRecipientDisplayName(recipient);
      // Show separator if not the last recipient OR if there will be hidden recipients
      const showSeparator = i < recipients.length - 1;
      const text = buildRecipientText(prefix, displayName, showSeparator);
      const textWidth = measureText(text);

      // Check if this recipient fits (always show at least one)
      if (usedWidth + textWidth <= availableWidth || i === 0) {
        usedWidth += textWidth;
        count++;
      } else {
        break;
      }
    }

    setVisibleCount(count);
  };

  // Recalculate visible count when size or recipients change
  createEffect(() => {
    // Track dependencies
    containerRect();
    allRecipients();
    // Use requestAnimationFrame to ensure measurement element is ready
    requestAnimationFrame(() => {
      calculateVisibleCount();
    });
  });

  const visibleRecipients = createMemo(() => {
    return allRecipients().slice(0, visibleCount());
  });

  const hiddenCount = createMemo(() => {
    return totalCount() - visibleCount();
  });

  return (
    <div
      use:observedSize={{ setSize: setContainerRect }}
      class="flex items-center text-sm overflow-hidden whitespace-nowrap mt-1 min-w-0 flex-1 cursor-pointer"
      onclick={props.onClick}
    >
      {/* Hidden measurement element - must have same font styles */}
      <span
        ref={measureRef}
        class="absolute invisible whitespace-nowrap text-sm"
        aria-hidden="true"
      />

      <Show
        when={totalCount() > 0}
        fallback={<span class="text-failure-ink">Recipients required</span>}
      >
        <For each={visibleRecipients()}>
          {(item, index) => (
            <>
              <Tooltip
                tooltip={
                  <div class="text-xs select-text cursor-text">
                    {item.recipient.data.email}
                  </div>
                }
                class="inline shrink-0"
              >
                <span class="shrink-0">
                  {item.prefix}
                  {getRecipientDisplayName(item.recipient)}
                </span>
              </Tooltip>
              <Show
                when={
                  index() < visibleRecipients().length - 1 || hiddenCount() > 0
                }
              >
                <span>{RECIPIENT_SEPARATOR}</span>
              </Show>
            </>
          )}
        </For>
        <Show when={hiddenCount() > 0}>
          <span class="text-ink-muted shrink-0">+{hiddenCount()} more</span>
        </Show>
      </Show>
    </div>
  );
}

type UndoReplySnapshot = {
  threadId: string;
  draftId: string;
  bodyHtml: string;
  attachments: DraftFormAttachment[];
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

export function BaseInput(props: {
  replyingTo: Accessor<ApiMessage | undefined>;
  // TODO: Remove `newMessage` props. It's not used...
  newMessage?: boolean;
  isEditingExisting?: boolean;
  draft?: ApiMessage;
  preloadedBody?: string;
  preloadedHtml?: string;
  sideEffectOnSend?: (newMessageId: ApiDraftOutputDbId | null) => void;
  onMarkDone?: () => void;
  setShowReply?: Setter<boolean>;
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
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
      });
    }

    // If we only have the draft available, then we're most likely
    // editing a draft in a new thread with no other messages
    if (props.draft && props.draft.db_id) {
      return getOrInitEmailFormContext({
        type: 'draft',
        messageID: props.draft.db_id,
      });
    }

    // Fallback to empty state
    return getOrInitEmailFormContext();
  });
  const blockId = useBlockId();
  const emailLinksQuery = useEmailLinksQuery();

  const [bodyMacro, setBodyMacro] = createSignal<string>('');
  const [expandedRecipientsRef, setExpandedRecipientsRef] =
    createSignal<HTMLDivElement>();
  const [editor, setEditor] = createSignal<LexicalEditor>();
  const [showExpandedRecipients, setShowExpandedRecipients] =
    createSignal<boolean>(false);
  const [isDragging, setIsDragging] = createSignal<boolean>();
  const [showFormatRibbon, setShowFormatRibbon] = createSignal<boolean>(
    props.newMessage ?? false
  );
  const [formatState, setFormatState] = createStore<SelectionData>(
    structuredClone(defaultSelectionData)
  );
  const [toRef, setToRef] = createSignal<HTMLInputElement>();
  const [ccRef, setCcRef] = createSignal<HTMLInputElement>();
  const [bccRef, setBccRef] = createSignal<HTMLInputElement>();
  const [showCc, setShowCc] = createSignal<boolean>();
  const [showBcc, setShowBcc] = createSignal<boolean>();
  const [recipientDragState, setRecipientDragState] = createSignal<{
    recipient: EmailRecipient;
    sourceField: 'to' | 'cc' | 'bcc';
  } | null>(null);
  const [savedDraftId, setSavedDraftId] = createSignal<
    ApiDraftOutputDbId | undefined
  >(
    props.draft?.db_id ??
      (undoReplySnapshot?.threadId === ctx.thread()?.db_id
        ? undoReplySnapshot?.draftId
        : undefined) ??
      undefined
  );

  // Consume undo-send snapshot if one exists and belongs to this thread (inline reply remount case).
  // Use bodyHtml as initialHtml for the editor, restore attachments on mount.
  const restoredSnapshot =
    undoReplySnapshot?.threadId === ctx.thread()?.db_id
      ? undoReplySnapshot
      : null;
  if (restoredSnapshot) {
    undoReplySnapshot = null;
    onMount(() => {
      for (const attachment of restoredSnapshot.attachments) {
        form().attachments.add(attachment);
      }
    });
  }

  // Register a callback so stale undoSend closures from a previous mount can
  // restore state into this (the live) component instance.
  restoreUndoCallback = (snapshot, draftId) => {
    setSavedDraftId(draftId);
    const currentEditor = editor();
    if (currentEditor && snapshot.bodyHtml) {
      setEditorStateFromHtml(currentEditor, snapshot.bodyHtml);
    }
    for (const attachment of snapshot.attachments) {
      form().attachments.add(attachment);
    }
  };
  onCleanup(() => {
    restoreUndoCallback = null;
  });

  let pendingMentions: { documentId: string }[] = [];
  const [shouldMarkDoneOnSuccess, setShouldMarkDoneOnSuccess] =
    createSignal(false);

  const undoSend = async (draftId: string) => {
    try {
      await emailClient.unscheduleMessage({ draftID: draftId });
      queryClient.invalidateQueries({
        queryKey: emailKeys.previews._def,
      });

      // Remove the sent message from the thread cache so it disappears from the list.
      const threadId = ctx.thread()?.db_id;
      if (threadId) {
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
        // Mark stale so next navigation fetches fresh data
        queryClient.invalidateQueries({
          queryKey: emailKeys.threadMessages(threadId).queryKey,
          refetchType: 'none',
        });
      }

      const snapshot = undoSendSnapshot;
      undoSendSnapshot = null;

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

      toast.success('Send cancelled');
      invalidateSoupEntity(draftId);
    } catch {
      toast.failure('Failed to undo send');
    }
  };

  const sendMutation = useSendMessageMutation({
    onSuccess: async ({ message }) => {
      const draftId = message.db_id;
      const toastId = toast.success(
        'Email sent',
        undefined,
        draftId
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
        10_000
      );
      pendingMentions.forEach((mention) => {
        trackMention(blockId, 'document', mention.documentId);
      });
      pendingMentions = [];
      refetchThreadMessages();
      props.sideEffectOnSend?.(message.db_id ?? null);
      if (shouldMarkDoneOnSuccess()) {
        props.onMarkDone?.();
        setShouldMarkDoneOnSuccess(false);
      }
    },
    onError: () => {
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

  // Attach side-effect handlers on mount; they replay against current state
  onMount(() => {
    form().setOnDirty(() => {
      scheduleDraftSave();
    });

    form().setOnReplyTypeApplied((rt) => {
      if (rt === 'forward') {
        setShowExpandedRecipients(true);
        setTimeout(() => {
          if (toRef()) {
            toRef()?.focus();
          }
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

  lazyRegister(editor, (editor) => {
    return registerToggleAppendedThread(editor);
  });

  const userEmail = useEmail();
  const userId = useUserId();
  const [userName] = useDisplayName(tryMacroId(userId() ?? ''));

  let draftSaveTimer: number | undefined;
  const DRAFT_DEBOUNCE_MS = 500;

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
        form().subject(),
        form().attachments.list().length,
        form().recipients().to.length +
          form().recipients().cc.length +
          form().recipients().bcc.length
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

  async function executeSaveDraft() {
    if (sendMutation.isPending) {
      return;
    }
    const draftToSave = collectDraft();
    if (!draftToSave) {
      const draftId = savedDraftId();
      if (draftId) {
        await deleteDraftMutation.mutateAsync({ draftId });
        refetchThreadMessages();
      }
      setSavedDraftId(undefined);
      return;
    }
    const currentThread = ctx.thread();
    const newMessage = props.newMessage ?? false;

    if (!currentThread && !newMessage) {
      logger.error(new Error('Failed to save draft: thread not found'));
      return;
    }

    if (newMessage && currentThread) {
      logger.error(
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
        });
      }

      setSavedDraftId(draftId);
      refetchThreadMessages();
      return draftId;
    }
  }

  function scheduleDraftSave() {
    if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(() => {
      void executeSaveDraft();
    }, DRAFT_DEBOUNCE_MS);
  }

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

  // Handles clicks outside of the expanded recipients area
  const expandedPointerDownHandler = (e: PointerEvent) => {
    if (showExpandedRecipients()) {
      const combobox = document.querySelector('div[data-popper-positioner]');
      if (
        !expandedRecipientsRef()?.contains(e.target as Node) &&
        !combobox?.contains(e.target as Node)
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
      logger.error(new Error("Can't send email, no email thread found"));
      toast.failure('Email failed to send');
      return;
    }

    if (newMessage && currentThread) {
      toast.failure('Email failed to send');
      logger.error('New message and thread cannot be provided together');
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
        logger.error('Failed to load email links');
        return;
      }

      const linksData = emailLinksQuery.data;
      if (!linksData || linksData.links.length < 1) {
        toast.failure('Email failed to send: No email account connected');
        logger.error('No links found');
        return;
      }
      linkId = linksData.links[0].id;
    }

    const currentEditor = editor();

    // Ensure draft is saved before sending so undo-send always has a draft to restore
    if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
    await executeSaveDraft();

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
    setShouldMarkDoneOnSuccess(markDone);

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
      },
    });

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
    const draftId = savedDraftId();
    if (draftId) {
      await deleteDraftMutation.mutateAsync({ draftId });
      refetchThreadMessages();
    }
    resetState();
    form().setReplyAppended(false);
    clearDraftState();
  };

  const handleUserMention = (mention: UserMentionRecord) => {
    // Extract the email from the mention argument
    const mentionEmail = mention.mentions[0].split('|')[1];

    // Check if user already in To or CC
    const isInTo = form()
      .recipients()
      .to.some((recipient: EmailRecipient) => {
        const email = recipient.data.email;
        if (!email) return false;
        return email === mentionEmail;
      });

    const isInCc = form()
      .recipients()
      .cc.some((recipient: EmailRecipient) => {
        const email = recipient.data.email;
        if (!email) return false;
        return email === mentionEmail;
      });

    // If not already in To or CC, add user to CC
    if (!isInTo && !isInCc) {
      // Find the user in recipient options, or construct from mention data
      const userOption =
        ctx.recipientOptions().find((recipient) => {
          const email = recipient.data.email;
          if (!email) return false;
          return email === mentionEmail;
        }) ?? convertContactInfoToEmailRecipient({ email: mentionEmail });

      // Add to CC recipients
      form().setRecipients('cc', [...form().recipients().cc, userOption]);
      toast.success(`${mentionEmail} added to CC`);
    }
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

  // Focus when external shouldFocus signal is set to true
  createEffect(() => {
    if (form().shouldFocusInput()) {
      if (!isMobile()) {
        requestAnimationFrame(() => {
          editor()?.focus();
          form().setShouldFocusInput(false);
        });
      } else {
        form().setShouldFocusInput(false);
      }
    }
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
      toast.failure(
        "Can't add more attachments",
        'Total attachments exceed 18MB limit'
      );
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
      });
    } else {
      removeAttachmentMutation.mutate({
        draftID: currentDraftID,
        attachmentID: attachment.attachmentID,
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
      });
      form().setSendTime(date);
      return;
    }

    form().setSendTime(date);

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
      const threadID = ctx.thread()?.db_id;
      if (threadID) {
        await emailClient.flagArchived({ id: threadID, value: true });
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

  return (
    <div
      ref={(el) => {
        composeContainerRef = el;
      }}
      class="relative flex flex-col flex-1 bg-input border-t border-x border-edge-muted rounded-t-[5px] -mb-[7px] max-w-full"
    >
      {/* Top Bar */}
      <div class="relative flex items-start gap-2 p-2">
        <DropdownMenu>
          <DropdownMenu.Trigger>
            <div class="px-1">
              <Button class="p-0 pr-1 gap-0">
                <Switch>
                  <Match when={effectiveReplyType() === 'reply'}>
                    <Reply class="h-7 p-1" />
                  </Match>

                  <Match when={effectiveReplyType() === 'reply-all'}>
                    <ReplyAll class="h-7 p-1" />
                  </Match>
                  <Match when={effectiveReplyType() === 'forward'}>
                    <Forward class="h-7 p-1" />
                  </Match>
                </Switch>
                <ChevronDown class="size-3" />
              </Button>
            </div>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenuContent>
              <MenuItem
                icon={Reply}
                text="Reply"
                onClick={() => form().setReplyType('reply')}
              />
              <Show
                when={
                  (props.replyingTo()?.to.length ?? 0) +
                    (props.replyingTo()?.cc.length ?? 0) >
                  1
                }
              >
                <MenuItem
                  icon={ReplyAll}
                  text="Reply All"
                  onClick={() => form().setReplyType('reply-all')}
                />
              </Show>
              <MenuItem
                icon={Forward}
                text="Forward"
                onClick={() => form().setReplyType('forward')}
              />
            </DropdownMenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <Show
          when={showExpandedRecipients()}
          fallback={
            <TruncatedRecipientList
              toRecipients={form().recipients().to}
              ccRecipients={form().recipients().cc}
              bccRecipients={form().recipients().bcc}
              onClick={() => setShowExpandedRecipients(true)}
            />
          }
        >
          <div
            ref={setExpandedRecipientsRef}
            class="w-full text-sm text-ink-muted"
          >
            {/* Expanded FROM */}
            <div class="flex flex-row items-baseline py-0.5">
              <div class="min-w-8">from</div>
              <span class="ml-2">
                {userName()} &lt;{userEmail()}&gt;
              </span>
            </div>
            {/* Expanded TO */}

            <RecipientDropRow
              field="to"
              class="-mt-0.5"
              dragState={recipientDragState}
              onDrop={handleRecipientDrop}
            >
              <div class="min-w-8">to</div>
              <RecipientSelector<EmailRecipient['kind']>
                inputRef={setToRef}
                options={ctx.recipientOptions}
                selectedOptions={form().recipients().to}
                setSelectedOptions={withDraftSave((v) =>
                  form().setRecipients('to', v)
                )}
                triggerMode="input"
                hideBorder
                onChipDragStart={(option, e) =>
                  handleChipDragStart('to', option, e)
                }
                onChipDragEnd={handleChipDragEnd}
              />
            </RecipientDropRow>
            {/* Expanded CC */}
            <Show when={showCc() || form().recipients().cc.length > 0}>
              <RecipientDropRow
                field="cc"
                class="-mt-1.5"
                dragState={recipientDragState}
                onDrop={handleRecipientDrop}
              >
                <div class="min-w-8">cc</div>
                <RecipientSelector<EmailRecipient['kind']>
                  inputRef={setCcRef}
                  options={ctx.recipientOptions}
                  selectedOptions={form().recipients().cc}
                  setSelectedOptions={withDraftSave((v) =>
                    form().setRecipients('cc', v)
                  )}
                  triggerMode="input"
                  hideBorder
                  onChipDragStart={(option, e) =>
                    handleChipDragStart('cc', option, e)
                  }
                  onChipDragEnd={handleChipDragEnd}
                />
              </RecipientDropRow>
            </Show>
            {/* Expanded BCC */}
            <Show when={showBcc() || form().recipients().bcc.length > 0}>
              <RecipientDropRow
                field="bcc"
                class="-mt-1.5"
                dragState={recipientDragState}
                onDrop={handleRecipientDrop}
              >
                <div class="min-w-8">bcc</div>
                <RecipientSelector<EmailRecipient['kind']>
                  inputRef={setBccRef}
                  options={ctx.recipientOptions}
                  selectedOptions={form().recipients().bcc}
                  setSelectedOptions={withDraftSave((v) =>
                    form().setRecipients('bcc', v)
                  )}
                  triggerMode="input"
                  hideBorder
                  onChipDragStart={(option, e) =>
                    handleChipDragStart('bcc', option, e)
                  }
                  onChipDragEnd={handleChipDragEnd}
                />
              </RecipientDropRow>
            </Show>
            {/* Show to, cc, bcc buttons */}
            <div class="flex flex-row justify-end space-x-2 pt-2">
              <Show when={!showCc()}>
                <Tooltip tooltip="Add cc recipients">
                  <div
                    onclick={() => {
                      setShowCc(true);
                      ccRef()?.focus();
                    }}
                    class="text-xs hover:underline"
                  >
                    cc
                  </div>
                </Tooltip>
              </Show>
              <Show when={!showBcc()}>
                <Tooltip tooltip="Add bcc recipients">
                  <div
                    onclick={() => {
                      setShowBcc(true);
                      bccRef()?.focus();
                    }}
                    class="text-xs hover:underline"
                  >
                    bcc
                  </div>
                </Tooltip>
              </Show>
            </div>
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
          placeholder="Subject"
        />
      </div>
      <div class="w-full h-full flex flex-col">
        <Show when={showFormatRibbon()}>
          <div class="flex flex-row w-full gap-2 items-center p-2">
            <FormatButtons
              selectionState={() => formatState}
              includeQuote
              onInlineFormat={(format) => {
                const editor_ = editor();
                if (!editor_) return;
                applyInlineFormat(editor_, format);
              }}
              onNodeFormat={(transform) => {
                const editor_ = editor();
                if (!editor_) return;
                const isActive = formatState.elementsInRange.has(transform);
                const targetTransform: NodeTransformType = isActive
                  ? 'paragraph'
                  : transform;
                applyNodeFormat(editor_, targetTransform);
              }}
            />
          </div>
        </Show>
        <div
          class="max-h-80 overflow-y-scroll w-full flex flex-col placeholder:text-ink-placeholder placeholder:opacity-50 px-3"
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
          <MarkdownTextarea
            captureEditor={(editor) => {
              setEditor(editor);
              form().setCapturedEditor(editor);
            }}
            class={cn(
              'ph-no-capture cursor-text text-sm break-words text-ink',
              isDragging() && 'blur'
            )}
            editable={() => !sendMutation.isPending}
            initialValue={props.preloadedBody}
            initialHtml={restoredSnapshot?.bodyHtml ?? props.preloadedHtml}
            placeholder="Reply — @mention to share or cc people"
            watermark={!hasPaidAccess() ? <MacroSignatureButton /> : undefined}
            onChange={handleChange}
            onDocumentMention={(item) => {
              makeAttachmentPublic(item.id);
              scheduleDraftSave();
            }}
            onUserMention={handleUserMention}
            portalScope="split"
            formatState={formatState}
            setFormatState={setFormatState}
            domRef={props.markdownDomRef}
            onPasteFilesAndDirs={(files, directories) => {
              const editor_ = editor();
              if (!editor_) return;
              handleFileFolderDrop(
                files,
                directories,
                createFilesReadyHandler(
                  editor_,
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
            }}
          />
          <div class="ph-no-capture flex gap-1 flex-wrap w-full py-2">
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
        </div>
        <div class="flex flex-row w-full h-8 justify-between items-center py-2 px-2 mb-2 space-x-2 allow-css-brackets">
          <div class="flex flex-row items-center gap-1">
            <div class="relative">
              <Button
                ref={(el) =>
                  fileSelector(el, () => ({
                    multiple: true,
                    onSelect: handleAddAttachments,
                  }))
                }
                size="icon-sm"
                tooltip="Attach"
              >
                <Paperclip />
              </Button>
            </div>

            <Button
              onclick={() => {
                setShowFormatRibbon(!showFormatRibbon());
              }}
              tooltip="Show formatting toolbar"
              size="icon-sm"
            >
              <TextAa />
            </Button>

            <Tooltip
              tooltip={
                form().replyAppended() ? 'Hide quoted text' : 'Show quoted text'
              }
            >
              <KToggleButton
                as={Button}
                size="icon-sm"
                pressed={form().replyAppended()}
                onChange={() => {
                  const replyingToID = props.replyingTo()?.replying_to_id;
                  if (!replyingToID) return;

                  const currentlyAppended = form().replyAppended();
                  form().setReplyAppended(!currentlyAppended);

                  editor()?.dispatchCommand(
                    TOGGLE_APPEND_EMAIL_THREAD_COMMAND,
                    {
                      replyingTo: props.replyingTo(),
                      replyType: effectiveReplyType(),
                      visible: !currentlyAppended,
                    }
                  );

                  editor()?.update(() => {
                    $getRoot().getFirstChild()?.selectStart();
                  });
                }}
              >
                <Quotes />
              </KToggleButton>
            </Tooltip>
            <Show when={ENABLE_EMAIL_SCHEDULED_SEND}>
              <EmailDateSelector
                sendTime={form().sendTime() ?? null}
                onSendTimeChange={handleSendTimeChange}
                disabled={
                  form().recipients().to.length === 0 &&
                  form().recipients().cc.length === 0 &&
                  form().recipients().bcc.length === 0
                }
                disablePortal={isMobile()}
              />
            </Show>
            <Show when={savedDraftId()}>
              <Button
                onclick={deleteDraftAndReset}
                tooltip="Delete draft"
                class="aspect-square p-1"
              >
                <Trash class="h-5" />
              </Button>
            </Show>
          </div>

          <Tooltip
            tooltip={form().sendTime() ? 'Send time is scheduled' : undefined}
          >
            <button
              disabled={
                uploadAttachmentMutation.isPending ||
                sendMutation.isPending ||
                !!form().sendTime()
              }
              onClick={() => sendEmail()}
              class="text-ink-muted hover:scale-115 transition ease-in-out flex-col items-center rounded-full p-[0.25lh] hover:bg-transparent disabled:opacity-30"
            >
              <Show
                when={!sendMutation.isPending}
                fallback={
                  <Spinner class="size-6 animate-spin cursor-disabled" />
                }
              >
                <div class="group hover:bg-accent transition ease-in-out size-6 border border-accent rounded-full flex items-center justify-center p-0">
                  <ArrowUp class="group-hover:!text-input group-hover:!fill-input !text-accent-ink !fill-accent size-4 transition ease-in-out" />
                </div>
              </Show>
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
