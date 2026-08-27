import {
  makeMarkDoneAction,
  makeMarkNotDoneAction,
} from '@app/features/next-soup/actions';
import { useMaybeSoup } from '@app/features/next-soup/soup-context';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { URL_PARAMS } from '@block-email/constants';
import { convertContactInfoToEmailRecipient } from '@block-email/util/recipientConversion';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import { useEmail, useUserId } from '@core/context/user';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import {
  recipientEntityMapper,
  useContacts,
  type WithCustomUserInput,
} from '@core/user';
import {
  compositeEntity,
  createEffectOnEntityTypeNotification,
  setDoneOverride,
} from '@notifications';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { queryClient } from '@queries/client';
import { emailKeys } from '@queries/email/keys';
import { useNonPrimaryEmailLinkIdHeader } from '@queries/email/link';
import {
  blockSenderWithToast,
  markSenderNoiseWithToast,
  markSenderSignalWithToast,
  trackExternalThreadArchive,
  useMarkThreadAsSeenMutation,
  useMarkThreadAsUnreadMutation,
  useThreadQuery,
  useUndoableArchiveThreadMutation,
} from '@queries/email/thread';
import {
  bulkMarkNotificationsAsDone,
  bulkMarkNotificationsAsUndone,
  fetchDoneNotificationIdsByEventItemIds,
} from '@queries/notification/user-notifications';
import {
  getSoupEntityById,
  invalidateAllSoup,
  refetchSoupEntity,
} from '@queries/soup/cache';
import { mapApiSoupItemToEntity } from '@queries/soup/transform-utils';
import type { UndoHandle } from '@queries/undo';
import type {
  ApiMessage,
  ApiThread,
  ContactInfo,
} from '@service-email/generated/schemas';
import { useSearchParams } from '@solidjs/router';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  type FlowProps,
  onCleanup,
  Suspense,
  untrack,
  useContext,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ReplyType } from '../util/replyType';

/**
 * Tracks thread IDs that had a draft saved since the last query fetch.
 * When the EmailProvider unmounts, threads in this set have their query
 * cache cleared so the next visit fetches fresh data (with the draft).
 * This avoids touching the active query during draft save, which would
 * trigger Suspense DOM detach and reset scroll position.
 */
const draftSavedThreadIds = new Set<string>();
export function markThreadDraftSaved(threadId: string) {
  draftSavedThreadIds.add(threadId);
}
export type EmailRecipient = WithCustomUserInput<'user' | 'contact'>;

type ArchiveThreadOptions = {
  silent?: boolean;
  onUndoHandle?: (handle: UndoHandle) => void;
  nextEntityId?: string;
};

type EmailContextValues = {
  registerMessagesList: (list: HTMLElement) => void;
  messagesListRef: Accessor<HTMLElement | undefined>;
  registerMessagesContainer: (container: HTMLElement) => void;
  messagesContainerRef: Accessor<HTMLElement | undefined>;

  recipientOptions: Accessor<EmailRecipient[]>;
  onRecipientsChange: (items: EmailRecipient[]) => void;

  drafts: {
    getDraftForMessage: (messageDbID: string) => ApiMessage | undefined;
    deleteDraftForMessage: (messageDbID: string) => void;
    initialDraftsSettled: Accessor<boolean>;
  };

  messages: {
    unfiltered: Accessor<ApiMessage[]>;
    list: Accessor<ApiMessage[]>;
    targetMessageID: Accessor<string | undefined>;
    setTargetMessageID: (id: string | undefined) => void;
    focusedID: Accessor<string | undefined>;
    setFocused: (messageID: string | undefined) => void;
    expandedBodyIds: Record<string, boolean>;
    setExpandedBodyId: (id: string, expanded: boolean) => void;
    isBodyExpanded: (id: string) => boolean;
    replyingToMessageId: Accessor<string | undefined>;
    setReplyingToMessageId: (id: string | undefined) => void;
    bottomReplyOpen: Accessor<boolean>;
    setBottomReplyOpen: (open: boolean) => void;
    // Sender emails (lowercased) with a CATEGORY_PERSONAL message in the thread
    personalSenders: Accessor<Set<string>>;
  };
  mobileReplyComposer: {
    open: Accessor<boolean>;
    messageId: Accessor<string | undefined>;
    setOpen: (open: boolean) => void;
    openForMessage: (id: string) => void;
    close: () => void;
  };
  replyRequest: {
    messageId: Accessor<string | undefined>;
    replyType: Accessor<ReplyType | undefined>;
    set: (messageId: string, replyType: ReplyType) => void;
    clear: () => void;
  };
  thread: Accessor<ApiThread | undefined>;
  permissions: Accessor<{
    type: Permissions;
    isOwner: boolean;
  }>;

  query: {
    hasMore: Accessor<boolean>;
    isFetching: Accessor<boolean>;
    fetchNextPage: () => void;
    refetch: () => void;
  };

  archiveThread: (opts?: ArchiveThreadOptions) => boolean;
  /** True when the thread is archived, i.e. currently marked done. */
  isThreadDone: Accessor<boolean>;
  /** True when the done state can actually be reversed — see
   *  `markThreadNotDone`. */
  canMarkThreadNotDone: Accessor<boolean>;
  /** Unarchives a done thread and restores its notifications. */
  markThreadNotDone: () => boolean;
  /** True when the user marked the open thread unread. Resets to false per
   *  thread — viewing marks it read, so the toggle starts at Mark Unread. */
  isThreadMarkedUnread: Accessor<boolean>;
  /** Marks the open thread unread; the toggle then offers Mark Read. */
  markThreadUnread: () => boolean;
  /** Re-marks the thread read after a mark-unread. */
  markThreadRead: () => boolean;
  getMarkDoneNavigationTargetId: () => string | undefined;
  blockSender: () => boolean;
  markSenderSignal: () => boolean;
  markSenderNoise: () => boolean;
  initialLoadComplete: Accessor<boolean>;
  onInitialDataLoad: (callback: () => boolean) => void;
};

const EmailContext = createContext<EmailContextValues>();

export function EmailProvider(props: FlowProps<{ threadID: string }>) {
  const threadQuery = useThreadQuery(
    () => props.threadID,
    () => ({
      select(data) {
        const messages = data.pages.flatMap((t) => t.messages);

        // Sort all messages by recency
        messages.sort((a, b) => {
          if (a.internal_date_ts && b.internal_date_ts) {
            return (
              new Date(a.internal_date_ts).getTime() -
              new Date(b.internal_date_ts).getTime()
            );
          }
          // Below is fallback for when internal_date_ts is not set
          else if (a.sent_at && b.sent_at) {
            return (
              new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
            );
          }
          return 0;
        });

        const filtered = [];
        const messageDraftMap: Record<string, ApiMessage> = {};

        for (const message of messages) {
          if (!message.is_draft) {
            filtered.push(message);
            continue;
          }

          if (message.body_html_sanitized?.trim().length === 0) {
            continue;
          }

          const replyingToId = message.replying_to_id;

          if (!replyingToId) continue;

          messageDraftMap[replyingToId] = message;
        }

        return {
          ...data.pages[0],
          messages: messages,
          filtered: filtered,
          draftMap: messageDraftMap,
        };
      },
    })
  );

  const notificationSource = useGlobalNotificationSource();

  createEffectOnEntityTypeNotification(
    notificationSource,
    'email',
    (notification) => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'new_email') return;
      if (meta.content.threadId === threadQuery.data?.db_id) {
        threadQuery.refetch();
      }
    }
  );

  const [focusedMessageId, setFocusedMessageId] = createSignal<string>();
  const [replyingToMessageId, setReplyingToMessageId] = createSignal<string>();
  const [bottomReplyOpen, setBottomReplyOpen] = createSignal(false);
  const [mobileReplyComposerOpen, setMobileReplyComposerOpen] =
    createSignal(false);
  const [mobileReplyComposerMessageId, setMobileReplyComposerMessageId] =
    createSignal<string>();
  const [replyRequestMessageId, setReplyRequestMessageId] =
    createSignal<string>();
  const [replyRequestType, setReplyRequestType] = createSignal<ReplyType>();
  const [expandedMessageBodyIds, setExpandedMessageBodyIds] = createStore<
    Record<string, boolean>
  >({});
  const [searchParams] = useSearchParams();
  const searchParamsMessageId = () => {
    const messageID = searchParams[URL_PARAMS.messageId];
    if (typeof messageID === 'string') {
      return messageID;
    } else if (Array.isArray(messageID)) {
      return messageID[0];
    }
    return undefined;
  };
  const [targetMessageId, setTargetMessageId] = createSignal<
    string | undefined
  >(searchParamsMessageId());

  const [hasHandledTarget, setHasHandledTarget] = createSignal(false);

  const blockHandle = blockHandleSignal.get;
  createMethodRegistration(blockHandle, {
    goToLocationFromParams: (params: Record<string, any>) => {
      if (params[URL_PARAMS.messageId]) {
        setTargetMessageId(undefined);
        setTimeout(() => {
          setTargetMessageId(params[URL_PARAMS.messageId]);
          setHasHandledTarget(false);
        }, 0);
      }
    },
  });

  // The newest version of each reply draft seen across query snapshots,
  // keyed by the replied-to message id. A cached snapshot populates this the
  // moment it's available (the composer must not wait on the network), and a
  // later fetch upgrades an entry only when its updated_at is newer — so the
  // revalidation of a stale cache wins, but an out-of-order response can't
  // downgrade a draft. Entries missing from a fetch are kept: deletes are
  // handled locally below, and dropping one would collapse an open composer.
  const serverDrafts = createMemo<
    { threadDbId: string; map: Record<string, ApiMessage> } | undefined
  >((prev) => {
    const data = threadQuery.data;
    if (!data) return undefined;
    const next = data.draftMap;
    if (!prev || prev.threadDbId !== data.db_id) {
      return { threadDbId: data.db_id, map: next };
    }
    const map: Record<string, ApiMessage> = { ...next };
    for (const [messageId, prevDraft] of Object.entries(prev.map)) {
      const nextDraft = map[messageId];
      if (
        !nextDraft ||
        new Date(nextDraft.updated_at).getTime() <
          new Date(prevDraft.updated_at).getTime()
      ) {
        map[messageId] = prevDraft;
      }
    }
    return { threadDbId: data.db_id, map };
  });

  // Drafts the user discarded this session. Kept apart from the server map so
  // a fetch that still contains the deleted draft (delete propagation lag)
  // can't resurrect it.
  const [deletedDraftIds, setDeletedDraftIds] = createStore<
    Record<string, true>
  >({});

  const deleteDraftForMessage = (messageID: string) => {
    setDeletedDraftIds(messageID, true);
  };

  const getDraftForMessage = (messageID: string) => {
    if (deletedDraftIds[messageID]) return undefined;
    return serverDrafts()?.map[messageID];
  };

  // Drafts derive straight from the query, so "settled" is simply "we have a
  // thread snapshot" — cached or fresh, revalidating or not.
  const initialDraftsSettled = () => serverDrafts() !== undefined;

  const contacts = useContacts();

  const [augmentedRecipients, setAugmentedRecipients] = createSignal<
    EmailRecipient[]
  >([]);

  function onRecipientsChange(items: EmailRecipient[]) {
    const existing = augmentedRecipients();
    const existingEmails = new Set(
      existing.map((r) => r.data.email).filter((e) => e.length > 0)
    );

    const uniques: EmailRecipient[] = [];
    for (const r of items) {
      const email = r.data.email;
      if (email && !existingEmails.has(email)) {
        existingEmails.add(email);
        uniques.push(r);
      }
    }

    if (uniques.length === 0) return;
    setAugmentedRecipients([...existing, ...uniques]);
  }

  const getRecipientOptions = () => {
    const optionsMap = new Map<string, EmailRecipient>();

    for (const contact of contacts()) {
      const mapped = recipientEntityMapper('contact')({
        type: 'extracted',
        email: contact.email,
        id: contact.id,
        name: contact.name,
      });
      optionsMap.set(mapped.data.email, mapped);
    }

    const thread = threadQuery.data;
    if (thread) {
      const seen = new Map<string, ContactInfo>();

      const add = (c: ContactInfo) => {
        const existing = seen.get(c.email);
        if (!existing || (!existing.name && c.name)) seen.set(c.email, c);
      };

      thread.messages.forEach((m) => {
        m.to.forEach(add);
        m.cc.forEach(add);
        m.bcc.forEach(add);
        if (m.from?.email)
          add({
            email: m.from.email,
            name: m.from.name ?? undefined,
          });
      });

      for (const value of seen.values()) {
        const mapped = convertContactInfoToEmailRecipient(value);
        optionsMap.set(mapped.data.email, mapped);
      }
    }

    augmentedRecipients().forEach((r) => {
      const email = r.data.email;
      if (email && !optionsMap.has(email)) optionsMap.set(email, r);
    });

    return Array.from(optionsMap.values());
  };

  const soup = useMaybeSoup();
  const splitPanel = useSplitPanel();

  const userId = useUserId();

  const markAsDoneAction = makeMarkDoneAction({
    notificationSource: () => notificationSource,
    userId,
  });

  const markNotDoneAction = makeMarkNotDoneAction({
    notificationSource: () => notificationSource,
  });

  // Notification ids the mark-not-done fallback restored, per thread, so the
  // undo/redo hooks below can re-mark them when the archive flip is replayed.
  const restoredNotificationIds = new Map<string, string[]>();

  // Only the direct archive/unarchive fallbacks go through this mutation
  // (the mark-done / mark-not-done action paths toast on their own).
  const archiveMutation = useUndoableArchiveThreadMutation({
    onPushed: (handle, params) => {
      params.onUndoHandle?.(handle);
      const message = params.archive ? 'Marked as done' : 'Marked as not done';
      let toastId: number | undefined;

      const showToast = () => {
        if (params.silent) return;
        toastId = toast.success(message, {
          actions: [
            {
              label: 'Undo',
              icon: ArrowCounterClockwise,
              onClick: () => {
                handle.undo({
                  onError: () => toast.failure('Failed to undo'),
                });
              },
            },
          ],
          duration: 3_000,
          stack: true,
          hideOnMobile: true,
        });
      };

      showToast();

      // Undo/redo replay only the /archived flip; mirror the fallback's
      // notification and soup-list side effects for the resulting state.
      const syncSideEffects = (nowArchived: boolean) => {
        const ids = restoredNotificationIds.get(params.threadId) ?? [];
        if (ids.length > 0) {
          setDoneOverride(ids, nowArchived);
          void (
            nowArchived
              ? bulkMarkNotificationsAsDone(ids)
              : bulkMarkNotificationsAsUndone(ids)
          ).catch(() => setDoneOverride(ids, undefined));
        }
        if (!nowArchived) {
          void refetchSoupEntity(params.threadId, 'emailThread');
        }
        invalidateAllSoup();
      };

      return {
        onUndone: () => {
          if (toastId !== undefined) toast.dismiss(toastId);
          syncSideEffects(!params.archive);
        },
        onRedone: () => {
          showToast();
          syncSideEffects(params.archive);
        },
      };
    },
    onError: (params) => {
      toast.failure(
        params.archive ? 'Failed to mark as done' : 'Failed to mark as not done'
      );
    },
  });

  const toHeaderLinkId = useNonPrimaryEmailLinkIdHeader();

  const getMarkDoneNavigationTargetId = () => {
    if (!soup) return;

    const focusedId = soup.focus.id();
    const navigationOptions = {
      wrapNavigation: false,
      skipGroupHeaders: true,
      skipLoadMore: true,
    };
    const candidates = [
      soup.navigate.peekOffset(1, navigationOptions)?.row,
      soup.navigate.peekOffset(-1, navigationOptions)?.row,
    ];
    return candidates.find((row) => row && row.id !== focusedId)?.id;
  };

  const isThreadDone = () => {
    const thread = threadQuery.data;
    return thread ? !thread.inbox_visible : false;
  };

  // Doneness is derived, not stored: `inbox_visible` is recomputed from the
  // thread's messages as "some message has INBOX and not SENT", and the inbox
  // view additionally requires an inbound message. A thread with only sent
  // messages can satisfy neither, so it is permanently done — unarchiving it
  // reverts on the next recompute and meanwhile labels its sent messages
  // INBOX, in Gmail too. Only offer the reversal when it can hold.
  const canMarkThreadNotDone = () => {
    const thread = threadQuery.data;
    if (!thread) return false;
    return !thread.inbox_visible && thread.latest_inbound_message_ts != null;
  };

  // Resolve a thread's soup representation for the mark-done / mark-not-done
  // paths: the live list row when it's rendered, else the normalized
  // soup-cache entity. Shared by markThreadNotDone and archiveThread.
  const resolveThreadSoupLookup = (threadId: string) => {
    const selectedRow = soup?.items.get(threadId);
    const cachedItem = selectedRow ? undefined : getSoupEntityById(threadId);
    return { selectedRow, cachedItem };
  };

  const markThreadNotDone = () => {
    const thread = threadQuery.data;
    if (!thread?.db_id) return false;

    if (thread.inbox_visible) return false;

    if (!canMarkThreadNotDone()) return false;

    // Mark-not-done issues the /archived request itself (plus notification
    // and soup-cache restore), so the path below skips archiveMutation and
    // only mirrors its thread-cache handling via trackExternalThreadArchive.
    const { selectedRow, cachedItem } = resolveThreadSoupLookup(thread.db_id);

    const entity =
      selectedRow?.original ??
      (cachedItem &&
      cachedItem.tag !== 'channelThread' &&
      cachedItem.tag !== 'calendarEvent'
        ? mapApiSoupItemToEntity(cachedItem)
        : undefined);

    if (entity && markNotDoneAction.canExecute(entity)) {
      void trackExternalThreadArchive(
        thread.db_id,
        markNotDoneAction.execute([entity]),
        false
      );
    } else {
      // No soup entity to drive the action from — the mark-done removal
      // evicted it from the soup caches (or its done state hasn't caught up
      // with the thread's): unarchive directly, then refetch the thread's
      // soup item to reinsert its rows and refetch the lists.
      const threadId = thread.db_id;
      // Snapshot the thread's notification ids now — the entity path restores
      // them via executeMarkEntitiesUndone, so mirror that here or they stay
      // done after the unarchive.
      const notificationIds = (
        notificationSource.notificationsByEntity()[
          compositeEntity({ type: 'email_thread', id: threadId })
        ] ?? []
      ).map((n) => n.id);
      archiveMutation.mutate(
        {
          threadId,
          archive: false,
          linkId: toHeaderLinkId(thread.link_id),
        },
        {
          onSuccess: async () => {
            // The live notification stream only carries not-done
            // notifications, so the thread's done ids may have aged out of
            // the local cache — merge the server's view (best effort: the
            // unarchive itself already succeeded).
            const serverIds = await fetchDoneNotificationIdsByEventItemIds([
              threadId,
            ]).catch(() => []);
            const allIds = [...new Set([...notificationIds, ...serverIds])];
            // Record for the undo/redo hooks, which re-mark these when the
            // archive flip is replayed.
            restoredNotificationIds.set(threadId, allIds);
            if (allIds.length > 0) {
              setDoneOverride(allIds, false);
              try {
                await bulkMarkNotificationsAsUndone(allIds);
              } catch {
                // The unarchive itself succeeded, so keep that outcome and
                // let the override fall back to the server's done state.
                setDoneOverride(allIds, undefined);
                toast.failure('Failed to mark as not done');
              }
            }
            void refetchSoupEntity(threadId, 'emailThread');
            invalidateAllSoup();
          },
        }
      );
    }

    return true;
  };

  const archiveThread = (opts?: ArchiveThreadOptions) => {
    const thread = threadQuery.data;
    // `=== true` because callers may pass this straight to an event handler.
    const markDoneOpts = {
      silent: opts?.silent === true,
      onUndoHandle: opts?.onUndoHandle,
      nextEntityId: opts?.nextEntityId,
    };

    if (!thread?.db_id) return false;

    if (!thread.inbox_visible) return false;

    // Mark done issues the /archived request itself (with undo support), so
    // the paths below skip archiveMutation and only mirror its thread-cache
    // handling via trackExternalThreadArchive.
    const { selectedRow, cachedItem } = resolveThreadSoupLookup(thread.db_id);

    if (soup && selectedRow) {
      void trackExternalThreadArchive(
        thread.db_id,
        markAsDoneAction.executeWithSoup(
          [selectedRow.original],
          soup,
          (nextEntity) => {
            const splitHandle = splitPanel?.handle;
            if (!splitHandle) return;
            void openEntityInSplitFromUnifiedList(nextEntity, {
              splitHandle,
              mergeHistory: true,
              referredFrom: splitHandle.referredFrom(),
            });
          },
          markDoneOpts
        )
      );
    } else if (
      cachedItem &&
      cachedItem.tag !== 'channelThread' &&
      cachedItem.tag !== 'calendarEvent'
    ) {
      // Not rendered inside a soup list (e.g. thread opened in a split): no
      // row to drive the action from, so mark done via the cached soup entity
      // so soup views drop the thread and its notifications settle.
      void trackExternalThreadArchive(
        thread.db_id,
        markAsDoneAction.execute(
          [mapApiSoupItemToEntity(cachedItem)],
          undefined,
          markDoneOpts
        )
      );
    } else {
      // No soup entity to drive mark-done from (e.g. the thread was opened
      // directly, so no soup list or cache exists): archive directly, still
      // honoring the caller's silent/undo-handle options — undo-send depends
      // on the handle to reverse this archive.
      archiveMutation.mutate({
        threadId: thread.db_id,
        archive: true,
        linkId: toHeaderLinkId(thread.link_id),
        silent: markDoneOpts.silent,
        onUndoHandle: markDoneOpts.onUndoHandle,
      });
    }

    return true;
  };

  const markSeenMutation = useMarkThreadAsSeenMutation();
  const markUnreadMutation = useMarkThreadAsUnreadMutation();

  // Viewing a thread marks it read (EmailDebouncedReadMarker), so each thread
  // starts with the toggle offering Mark Unread.
  const [threadMarkedUnread, setThreadMarkedUnread] = createSignal(false);
  createEffect(() => {
    void props.threadID;
    setThreadMarkedUnread(false);
  });

  const markThreadUnread = () => {
    const thread = threadQuery.data;
    if (!thread?.db_id) return false;
    if (threadMarkedUnread()) return false;
    // A toggle mid-flight would race the pending request; ignore it.
    if (markUnreadMutation.isPending || markSeenMutation.isPending) {
      return false;
    }

    const threadId = thread.db_id;
    setThreadMarkedUnread(true);
    markUnreadMutation.mutate(
      { threadId, linkId: thread.link_id },
      {
        onSuccess: () => {
          toast.success('Marked as unread', {
            duration: 3_000,
            stack: true,
            hideOnMobile: true,
          });
        },
        onError: () => {
          setThreadMarkedUnread(false);
          toast.failure('Failed to mark as unread');
          void refetchSoupEntity(threadId, 'emailThread');
        },
      }
    );
    return true;
  };

  const markThreadRead = () => {
    const thread = threadQuery.data;
    if (!thread?.db_id) return false;
    if (!threadMarkedUnread()) return false;
    // A toggle mid-flight would race the pending request; ignore it.
    if (markUnreadMutation.isPending || markSeenMutation.isPending) {
      return false;
    }

    const threadId = thread.db_id;
    setThreadMarkedUnread(false);
    markSeenMutation.mutate(
      { threadId, linkId: toHeaderLinkId(thread.link_id) },
      {
        onSuccess: () => {
          toast.success('Marked as read', {
            duration: 3_000,
            stack: true,
            hideOnMobile: true,
          });
        },
        onError: () => {
          setThreadMarkedUnread(true);
          toast.failure('Failed to mark as read');
          void refetchSoupEntity(threadId, 'emailThread');
        },
      }
    );
    return true;
  };

  const currentUserEmail = useEmail();

  const blockSender = () => {
    const thread = threadQuery.data;
    if (!thread?.messages?.length) return false;

    const userEmail = currentUserEmail()?.toLowerCase();
    const senderEmail = thread.messages.find(
      (m) =>
        m.from?.email &&
        (!userEmail || m.from.email.toLowerCase() !== userEmail)
    )?.from?.email;

    if (!senderEmail) return false;

    blockSenderWithToast(senderEmail, toHeaderLinkId(thread.link_id));
    return true;
  };

  const getSenderEmail = (): string | undefined => {
    const thread = threadQuery.data;
    if (!thread?.messages?.length) return undefined;

    const userEmail = currentUserEmail()?.toLowerCase();
    return thread.messages.find(
      (m) =>
        m.from?.email &&
        (!userEmail || m.from.email.toLowerCase() !== userEmail)
    )?.from?.email;
  };

  const markSenderSignal = () => {
    const senderEmail = getSenderEmail();
    if (!senderEmail) return false;
    markSenderSignalWithToast(
      senderEmail,
      toHeaderLinkId(threadQuery.data?.link_id)
    );
    return true;
  };

  const markSenderNoise = () => {
    const senderEmail = getSenderEmail();
    if (!senderEmail) return false;
    markSenderNoiseWithToast(
      senderEmail,
      toHeaderLinkId(threadQuery.data?.link_id)
    );
    return true;
  };

  const [messagesListRef, setMessagesListRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);
  const [messagesContainerRef, setMessagesContainerRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);

  let containerFilled = false;
  const isContainerFilled = () => {
    const messageList = messagesListRef();
    const containerRef = messagesContainerRef();

    // Skip if dependencies not ready
    if (
      !messageList ||
      !containerRef ||
      !untrack(() => threadQuery.data)?.db_id
    ) {
      containerFilled = false;
      return false;
    }

    // Skip if still loading or already filled
    if (threadQuery.isFetching || containerFilled) {
      return containerFilled;
    }

    const messageListHeight = messageList.getBoundingClientRect().height;
    const containerHeight = containerRef.getBoundingClientRect().height;

    // Load more if container isn't filled
    if (
      messageListHeight < containerHeight &&
      threadQuery.hasNextPage &&
      !threadQuery.isFetching
    ) {
      threadQuery.fetchNextPage();
      containerFilled = false;
      return false;
    }
    containerFilled = true;
    return true;
  };

  const onInitialDataLoad = (callback: () => boolean) => {
    createEffect(() => {
      if (hasHandledTarget()) return;
      const fetching = threadQuery.isFetching;
      if (fetching) return;
      // Check if initial loading is complete
      const isInitialLoadComplete =
        (isContainerFilled() || threadQuery.hasNextPage === false) &&
        !threadQuery.isFetching;

      if (!isInitialLoadComplete) return;

      // Skip if basic requirements not met
      if (!untrack(messagesListRef)) {
        return;
      }

      setHasHandledTarget(callback());
    });
  };

  const onExpandMessageBody = (messageID: string, expanded: boolean) => {
    const listContainer = messagesListRef();

    const lastScrollPosition = listContainer?.scrollTop;
    const lastScrollHeight = listContainer?.scrollHeight;

    setExpandedMessageBodyIds(messageID, expanded);

    if (
      !listContainer ||
      lastScrollPosition == null ||
      lastScrollHeight == null
    )
      return;

    // Maintain the scroll position when expansion changes
    queueMicrotask(() => {
      const lastPos = lastScrollHeight + lastScrollPosition;
      const currentPos = listContainer.scrollHeight + listContainer.scrollTop;

      // List is reversed, we need a negative value to maintain scroll
      // position
      const diff = lastPos - currentPos;

      messagesListRef()?.scrollBy({ top: diff });
    });
  };

  // When the provider unmounts (user navigates away), clear the thread query
  // cache if a draft was saved during this session. This ensures the next visit
  // fetches fresh data from the server (which includes the saved draft).
  // We can't invalidate/refetch while mounted because any query state change
  // triggers SolidQuery's createClientSubscriber → Resource.refetch() → Suspense
  // DOM detach, which resets scroll position.
  // `props.threadID` chains through the email block's non-keyed
  // `<Show when={threadId()}>` accessor, which is already stale during
  // disposal; capture it while mounted instead of reading it in the cleanup.
  createEffect(() => {
    const threadID = props.threadID;
    onCleanup(() => {
      if (draftSavedThreadIds.has(threadID)) {
        draftSavedThreadIds.delete(threadID);
        queryClient.removeQueries({
          queryKey: emailKeys.threadMessages(threadID).queryKey,
        });
      }
    });
  });

  return (
    <Suspense>
      <EmailContext.Provider
        value={{
          registerMessagesList: setMessagesListRef,
          registerMessagesContainer: setMessagesContainerRef,
          thread: createMemo(() => threadQuery.data),
          recipientOptions: createMemo(getRecipientOptions),
          onRecipientsChange,
          archiveThread,
          isThreadDone,
          canMarkThreadNotDone,
          markThreadNotDone,
          isThreadMarkedUnread: threadMarkedUnread,
          markThreadUnread,
          markThreadRead,
          getMarkDoneNavigationTargetId,
          blockSender,
          markSenderSignal,
          markSenderNoise,
          messagesContainerRef,
          messagesListRef,
          query: {
            hasMore: () => threadQuery.hasNextPage ?? false,
            fetchNextPage: threadQuery.fetchNextPage,
            isFetching: () =>
              threadQuery.isLoading || threadQuery.isFetchingNextPage,
            refetch: threadQuery.refetch,
          },
          drafts: {
            deleteDraftForMessage,
            getDraftForMessage,
            initialDraftsSettled,
          },
          messages: {
            focusedID: focusedMessageId,
            setFocused: setFocusedMessageId,
            targetMessageID: targetMessageId,
            setTargetMessageID: setTargetMessageId,
            list: createMemo(() => threadQuery.data?.filtered ?? []),
            unfiltered: createMemo(() => threadQuery.data?.messages ?? []),
            // Google's CATEGORY_PERSONAL classification is inconsistent across
            // identical messages, so promote it per-sender across the thread
            personalSenders: createMemo(() => {
              const senders = new Set<string>();
              for (const message of threadQuery.data?.messages ?? []) {
                const email = message.from?.email?.toLowerCase();
                if (!email) continue;
                if (
                  message.labels.some((l) => l.name === 'CATEGORY_PERSONAL')
                ) {
                  senders.add(email);
                }
              }
              return senders;
            }),
            expandedBodyIds: expandedMessageBodyIds,
            setExpandedBodyId: onExpandMessageBody,
            isBodyExpanded: (id: string) => expandedMessageBodyIds[id] ?? false,
            replyingToMessageId,
            setReplyingToMessageId,
            bottomReplyOpen,
            setBottomReplyOpen,
          },
          mobileReplyComposer: {
            open: mobileReplyComposerOpen,
            messageId: mobileReplyComposerMessageId,
            setOpen: setMobileReplyComposerOpen,
            openForMessage: (id: string) => {
              setMobileReplyComposerMessageId(id);
              setMobileReplyComposerOpen(true);
            },
            close: () => {
              setMobileReplyComposerOpen(false);
              setMobileReplyComposerMessageId(undefined);
            },
          },
          replyRequest: {
            messageId: replyRequestMessageId,
            replyType: replyRequestType,
            set: (messageId: string, replyType: ReplyType) => {
              setReplyRequestMessageId(messageId);
              setReplyRequestType(replyType);
            },
            clear: () => {
              setReplyRequestMessageId(undefined);
              setReplyRequestType(undefined);
            },
          },
          permissions: createMemo(() => {
            const perms = getPermissions(threadQuery.data?.access_level);
            return {
              type: perms,
              isOwner: hasPermissions(perms, Permissions.OWNER),
            };
          }),
          initialLoadComplete: hasHandledTarget,
          onInitialDataLoad,
        }}
      >
        {props.children}
      </EmailContext.Provider>
    </Suspense>
  );
}

export function useEmailContext() {
  const ctx = useContext(EmailContext);
  if (!ctx) {
    throw new Error('useEmailContext must be used within an EmailProvider');
  }
  return ctx;
}

export function useMaybeEmailContext() {
  return useContext(EmailContext);
}
