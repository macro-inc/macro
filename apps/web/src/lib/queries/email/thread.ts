import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult, throwOnErr } from '@core/util/result';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg?component-solid';
import { Telemetry } from '@macro-inc/observability';
import { emailClient } from '@service-email/client';
import type {
  ApiDraftInput,
  SendMessageResponse,
  ApiThread as Thread,
  UpsertScheduledResponse,
} from '@service-email/generated/schemas';
import { type InfiniteData, useMutation } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { refetchSoupEntity } from '../soup/cache';
import { revalidateMailImportanceLists } from '../soup/graphql/mail-list-revalidation';
import { invalidateAllSoup } from '../soup/normalized-cache';
import { type UndoHandle, useUndoableMutation } from '../undo';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { invalidateEmailFolderQueries } from './folder-cache';
import {
  createGraphqlEmailThreadQuery,
  fetchGraphqlEmailThread,
  mapGraphqlThreadError,
} from './graphql/thread';
import {
  archiveEmailThread,
  type EmailArchiveDisposition,
} from './integration';
import { emailKeys } from './keys';
import {
  type MarkThreadAsSeenParams,
  type MarkThreadAsUnreadParams,
  type MarkThreadAsUnreadResult,
  markEmailThreadSeen,
  markEmailThreadUnread,
} from './read-state';

/**
 * Flatten infinite query pages into a single thread with all messages.
 */
function flattenThreadPages(
  data: InfiniteData<Thread, number>
): Thread | undefined {
  if (!data?.pages[0]) return undefined;
  const firstPage = data.pages[0];
  return {
    ...firstPage,
    messages: data.pages.flatMap((p) => p.messages),
  };
}

/**
 * Imperatively fetch a thread through GraphQL and merge it into the normalized
 * cache. Network failures fall back to a complete cached first page.
 */
export async function fetchAndCacheThread(
  threadId: string
): ReturnType<typeof emailClient.getThread> {
  const result = await catchToResult(() => fetchGraphqlEmailThread(threadId));

  if (result.isErr()) return err(result.error as any);
  return ok({ thread: result.value });
}

/**
 * Read authoritative thread pages directly from REST, without GraphQL's
 * in-flight deduplication or offline cache fallback. Drafts have no internal
 * date and sort after sent messages, so continue until the requested message
 * is present or the server has no more pages.
 */
export async function fetchFreshEmailThread(
  threadId: string,
  requiredMessageId?: string
): Promise<Thread> {
  let offset = 0;
  let merged: Thread | undefined;

  while (true) {
    const page = (
      await throwOnErr(() =>
        emailClient.getThread({
          thread_id: threadId,
          offset,
          limit: DEFAULT_THREAD_MESSAGES_LIMIT,
        })
      )
    ).thread;

    merged = merged
      ? { ...page, messages: [...merged.messages, ...page.messages] }
      : page;

    if (
      !requiredMessageId ||
      page.messages.some((message) => message.db_id === requiredMessageId) ||
      page.messages.length < DEFAULT_THREAD_MESSAGES_LIMIT
    ) {
      return merged;
    }
    offset += page.messages.length;
  }
}

export type ThreadQueryData = {
  thread: Thread;
  hasMore: boolean;
};

export type ThreadQueryResult<TData> = {
  /** Canonical identity for this route, including a resolved offline handle. */
  readonly resolvedThreadId: string;
  readonly data: TData | undefined;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isError: boolean;
  readonly isSuccess: boolean;
  readonly isEnabled: boolean;
  readonly hasNextPage: boolean;
  fetchNextPage(): Promise<void>;
  refetch(): Promise<void>;
};

type ThreadQuerySelector<TData> = (data: InfiniteData<Thread, number>) => TData;

type UseThreadQueryOptions<TData> = {
  enabled?: boolean;
  select?: ThreadQuerySelector<TData>;
};

function selectThreadQueryData(
  data: InfiniteData<Thread, number>
): ThreadQueryData {
  const lastPage = data.pages.at(-1)!;
  return {
    thread: flattenThreadPages(data)!,
    hasMore: lastPage.messages.length === DEFAULT_THREAD_MESSAGES_LIMIT,
  };
}

/** Live GraphQL query for a thread and its paginated messages. */
export function useThreadQuery<TData>(
  threadId: Accessor<string>,
  options: Accessor<
    UseThreadQueryOptions<TData> & { select: ThreadQuerySelector<TData> }
  >
): ThreadQueryResult<TData>;
export function useThreadQuery(
  threadId: Accessor<string>,
  options?: Accessor<UseThreadQueryOptions<ThreadQueryData>>
): ThreadQueryResult<ThreadQueryData>;
export function useThreadQuery<TData = ThreadQueryData>(
  threadId: Accessor<string>,
  options?: Accessor<UseThreadQueryOptions<TData>>
): ThreadQueryResult<TData> {
  const select = () =>
    options?.().select ?? (selectThreadQueryData as ThreadQuerySelector<TData>);

  const { query, resolvedThreadId } = createGraphqlEmailThreadQuery<TData>(
    threadId,
    () => ({
      enabled: options?.().enabled !== false,
      select: select(),
    })
  );

  return {
    get resolvedThreadId() {
      return resolvedThreadId();
    },
    get data() {
      return query.data;
    },
    get error() {
      return query.error ? mapGraphqlThreadError(query.error) : null;
    },
    get isLoading() {
      return query.isLoading;
    },
    get isFetching() {
      return query.isFetching;
    },
    get isFetchingNextPage() {
      return query.isFetchingNextPage;
    },
    get isError() {
      return query.isError;
    },
    get isSuccess() {
      return query.isSuccess;
    },
    get isEnabled() {
      return query.isEnabled;
    },
    get hasNextPage() {
      return query.hasNextPage;
    },
    async fetchNextPage() {
      await query.fetchNextPage();
    },
    async refetch() {
      await query.refetch({ requestPolicy: 'network-only' });
    },
  };
}

/** Mutation wrapper for the shared optimistic thread read operation. */
export function useMarkThreadAsSeenMutation(
  callbacks?: MutationCallbacks<void, Error, MarkThreadAsSeenParams>
) {
  return useMutation(() => ({
    mutationFn: markEmailThreadSeen,
    ...withCallbacks<void, Error, MarkThreadAsSeenParams>({}, callbacks),
  }));
}

/**
 * Mark a thread unread through the shared mailbox-state contract.
 */
export function useMarkThreadAsUnreadMutation(
  callbacks?: MutationCallbacks<
    MarkThreadAsUnreadResult,
    Error,
    MarkThreadAsUnreadParams
  >,
  options?: { observeQueuedSettlement: boolean }
) {
  return useMutation(() => ({
    mutationFn: (params: MarkThreadAsUnreadParams) =>
      markEmailThreadUnread(params, options?.observeQueuedSettlement ?? false),
    ...withCallbacks<MarkThreadAsUnreadResult, Error, MarkThreadAsUnreadParams>(
      {
        onSettled: () => invalidateEmailFolderQueries(),
      },
      callbacks
    ),
  }));
}

type ArchiveThreadParams = {
  threadId: string;
  archive: boolean;
  /** Suppress the success toast, e.g. for a send-triggered archive where the
   *  send toast (with its undo-send action) is already up and this
   *  toast's own Undo would reverse only the archive, not the send. */
  silent?: boolean;
  /** Receives the undo handle once the archive is pushed onto the undo
   *  stack, so callers (e.g. undo-send) can reverse it programmatically. */
  onUndoHandle?: (handle: UndoHandle) => void;
};
function invalidateEmailPreviews() {
  queryClient.invalidateQueries({ queryKey: emailKeys.previews._def });
}

/**
 * Preview bookkeeping for an archive/unarchive performed by another mutation
 * (e.g. the mark-done and mark-not-done actions, which issue their own
 * archive writes): invalidates the preview queries once it settles. Mirrors
 * useUndoableArchiveThreadMutation's handling without firing a second request
 * or pushing an undo entry.
 */
export async function trackExternalThreadArchive(
  archived: Promise<unknown>
): Promise<void> {
  let disposition: unknown;
  try {
    disposition = await archived;
  } catch {
    // The action that issued the write reports its own failure.
  } finally {
    if (disposition !== 'queued') invalidateEmailPreviews();
  }
}

/**
 * One archive/unarchive cycle for undo/redo replays: the archive write, then
 * a preview invalidation once it settles. Mirrors what
 * `useUndoableArchiveThreadMutation` does through its mutation callbacks.
 */
async function replayThreadArchive(params: ArchiveThreadParams) {
  let disposition: EmailArchiveDisposition | undefined;
  try {
    disposition = await archiveEmailThread({
      id: params.threadId,
      value: params.archive,
    });
  } finally {
    if (disposition !== 'queued') invalidateEmailPreviews();
  }
}

/**
 * Mutation to archive or unarchive a thread. The GraphQL write owns the
 * optimistic `inboxVisible`. Each successful archive or unarchive is pushed
 * onto the mutation undo stack, and undo/redo replays the opposite call.
 * Must be used inside a MutationUndoProvider.
 */
export function useUndoableArchiveThreadMutation(options: {
  /** Bind side effects (e.g. an undo toast) to the pushed undo entry. */
  onPushed?: (
    handle: UndoHandle,
    params: ArchiveThreadParams
  ) => { onUndone?: () => void; onRedone?: () => void } | void;
  onError?: (params: ArchiveThreadParams) => void;
}) {
  return useUndoableMutation<
    EmailArchiveDisposition,
    Error,
    ArchiveThreadParams
  >(() => ({
    mutationFn: async (params: ArchiveThreadParams) =>
      await archiveEmailThread({
        id: params.threadId,
        value: params.archive,
      }),
    onError: (_err, params) => {
      options.onError?.(params);
    },
    onSettled: (disposition) => {
      if (disposition !== 'queued') invalidateEmailPreviews();
    },
    undoFn: async (params) => {
      await replayThreadArchive({ ...params, archive: !params.archive });
    },
    redoFn: async (params) => {
      await replayThreadArchive(params);
    },
    undoLabel: (params) => (params.archive ? 'Mark Done' : 'Mark Not Done'),
    onPushed: (handle, params) => options.onPushed?.(handle, params),
  }));
}

type SendMessageParams = {
  message: ApiDraftInput;
  /** Target inbox for a non-primary inbox; sent as the X-Email-Link-Id header. */
  linkId?: string;
  /** Skip the post-send soup refresh, e.g. when the thread is about to be
   *  marked done and removed from soup views — the refetch would race the
   *  removal and re-insert the row. */
  skipSoupRefetch?: boolean;
};

/**
 * Mutation to send an email message.
 */
export function useSendMessageMutation(
  callbacks?: MutationCallbacks<SendMessageResponse, Error, SendMessageParams>
) {
  const analytics = useAnalytics();

  return useMutation(() => ({
    mutationFn: async (vars: SendMessageParams) =>
      await throwOnErr(
        async () =>
          await emailClient.sendMessage({ message: vars.message }, vars.linkId)
      ),
    ...withCallbacks<SendMessageResponse, Error, SendMessageParams>(
      {
        onSuccess: (data, vars) => {
          try {
            analytics.track('email_message_sent');
          } catch (error) {
            Telemetry.error(error);
          }
          try {
            const threadID = data.message.thread_db_id;
            // Refresh the thread's soup item so inbox views stop showing it
            // as a draft once the message is sent.
            if (threadID && !vars.skipSoupRefetch) {
              void refetchSoupEntity(threadID, 'emailThread').catch(
                Telemetry.error
              );
            }
            void queryClient
              .invalidateQueries({
                queryKey: emailKeys.previews._def,
              })
              .catch(Telemetry.error);
          } catch (error) {
            Telemetry.error(error);
          }
        },
      },
      callbacks
    ),
  }));
}

type ScheduleMessageParams = {
  draftGeneration?: number;
  draftID: string;
  sendTime: Date;
  threadID?: string;
};

/**
 * Mutation to send an email message.
 */
function _useScheduleMessageMutation(
  callbacks?: MutationCallbacks<
    UpsertScheduledResponse,
    Error,
    ScheduleMessageParams
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: ScheduleMessageParams) =>
      await throwOnErr(
        async () =>
          await emailClient.scheduleMessage({
            draftID: vars.draftID,
            draftGeneration: vars.draftGeneration,
            send_time: vars.sendTime.toISOString(),
          })
      ),
    ...withCallbacks<UpsertScheduledResponse, Error, ScheduleMessageParams>(
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: emailKeys.previews._def,
          });
          queryClient.invalidateQueries({
            queryKey: emailKeys.scheduledMessages._def,
          });
        },
      },
      callbacks
    ),
  }));
}

type UnscheduleMessageParams = {
  draftGeneration?: number;
  draftID: string;
  /** Target inbox for a non-primary inbox; sent as the X-Email-Link-Id header. */
  linkId?: string;
};

/**
 * Mutation to send an email message.
 */
export function useUnscheduleMessageMutation(
  callbacks?: MutationCallbacks<void, Error, UnscheduleMessageParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: UnscheduleMessageParams) => {
      await throwOnErr(
        async () =>
          await emailClient.unscheduleMessage(
            {
              draftID: vars.draftID,
              draftGeneration: vars.draftGeneration,
            },
            vars.linkId
          )
      );
    },
    ...withCallbacks<void, Error, UnscheduleMessageParams>(
      {
        onSuccess: () => {
          try {
            void queryClient
              .invalidateQueries({
                queryKey: emailKeys.previews._def,
              })
              .catch(Telemetry.error);
            void queryClient
              .invalidateQueries({
                queryKey: emailKeys.scheduledMessages._def,
              })
              .catch(Telemetry.error);
          } catch (error) {
            Telemetry.error(error);
          }
        },
      },
      callbacks
    ),
  }));
}

/**
 * Blocks a sender and shows appropriate toasts with undo support.
 * Shared by the email thread view and soup context menu.
 */
export async function blockSenderWithToast(
  senderEmail: string,
  linkId?: string
) {
  const result = await emailClient.blockSender(
    {
      email_address: senderEmail,
    },
    linkId
  );

  if (result.isErr()) {
    toast.failure('Failed to block sender', { subtext: senderEmail });
    return;
  }

  toast.success('Sender block queued', {
    dismissStyle: 'icon',
    actionLayout: 'inline',
    subtext: `Applying the rule for ${senderEmail}`,
    actions: [
      {
        label: 'Undo',
        icon: ArrowCounterClockwise,
        onClick: async () => {
          const undoResult = await emailClient.unblockSender(
            {
              email_address: senderEmail,
            },
            linkId
          );
          if (undoResult.isErr()) {
            toast.failure('Failed to unblock sender', { subtext: senderEmail });
          } else {
            toast.success('Sender unblock queued');
          }
        },
      },
    ],
  });
}

function invalidateSenderFilterLists() {
  invalidateAllSoup();
  fireAndForget(revalidateMailImportanceLists(), 'email-sender-filter');
}

async function upsertSenderFilterWithToast(
  senderEmail: string,
  isImportant: boolean,
  linkId?: string
) {
  const label = isImportant ? 'Signal' : 'Noise';

  const result = await emailClient.upsertEmailFilter(
    {
      email_address: senderEmail,
      is_important: isImportant,
    },
    linkId
  );

  if (result.isErr()) {
    toast.failure(`Failed to mark sender as ${label}`, {
      subtext: senderEmail,
    });
    return;
  }

  const filterId = result.value.filter.id;
  invalidateSenderFilterLists();

  toast.success(`Sender marked as ${label}`, {
    dismissStyle: 'icon',
    actionLayout: 'inline',
    subtext: `Messages from ${senderEmail} will appear in ${label}`,
    actions: [
      {
        label: 'Undo',
        icon: ArrowCounterClockwise,
        onClick: async () => {
          const undoResult = await emailClient.deleteEmailFilter(
            { id: filterId },
            linkId
          );
          if (undoResult.isErr()) {
            toast.failure('Failed to undo', { subtext: senderEmail });
          } else {
            invalidateSenderFilterLists();
            toast.success('Sender filter removed');
          }
        },
      },
    ],
  });
}

/**
 * Marks a sender as Signal for one inbox. `linkId` scopes the filter to the
 * inbox the thread belongs to — omit it only for the primary inbox.
 */
export const markSenderSignalWithToast = (
  senderEmail: string,
  linkId?: string
) => upsertSenderFilterWithToast(senderEmail, true, linkId);

/**
 * Marks a sender as Noise for one inbox. See {@link markSenderSignalWithToast}
 * for how `linkId` is used.
 */
export const markSenderNoiseWithToast = (
  senderEmail: string,
  linkId?: string
) => upsertSenderFilterWithToast(senderEmail, false, linkId);
