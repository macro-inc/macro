import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import { catchToResult, throwOnErr } from '@core/util/result';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { emailClient } from '@service-email/client';
import type {
  ApiDraftInput,
  SendMessageResponse,
  ApiThread as Thread,
  UpsertScheduledResponse,
} from '@service-email/generated/schemas';
import {
  type InfiniteData,
  type SolidInfiniteQueryOptions,
  type UseInfiniteQueryResult,
  useInfiniteQuery,
  useMutation,
} from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { optimisticUpdateSoupEntity, refetchSoupEntity } from '../soup/cache';
import { invalidateAllSoup } from '../soup/normalized-cache';
import { type UndoHandle, useUndoableMutation } from '../undo';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { emailKeys } from './keys';

const THREAD_STALE_TIME = 5 * 60 * 1000;

type ThreadQueryOptions = SolidInfiniteQueryOptions<
  Thread,
  Error,
  any,
  ReturnType<typeof emailKeys.threadMessages>['queryKey'],
  number
>;

type UseThreadQueryOptions = Omit<
  ThreadQueryOptions,
  | 'queryFn'
  | 'queryKey'
  | 'initialData'
  | 'getNextPageParam'
  | 'initialPageParam'
>;

/**
 * Shared infinite query options for thread fetching.
 */
export function threadQueryOptions(threadId: string) {
  return {
    queryKey: emailKeys.threadMessages(threadId).queryKey,
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const result = await throwOnErr(
        async () =>
          await emailClient.getThread({
            thread_id: threadId,
            offset: pageParam,
            limit: DEFAULT_THREAD_MESSAGES_LIMIT,
          })
      );

      return result.thread;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage: Thread, allPages: Thread[]) => {
      if (lastPage.messages.length < DEFAULT_THREAD_MESSAGES_LIMIT) {
        return undefined;
      }
      return allPages.reduce((sum, p) => sum + p.messages.length, 0);
    },
    staleTime: THREAD_STALE_TIME,
  };
}

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
 * Imperatively fetch a thread (for use outside of components).
 * Returns cached data if fresh, otherwise fetches from server.
 *
 * TODO: Most of the time we have the updated_at timestamp of an email before we fetch it.
 * Would be nice to accept that as a parameter and only fetch if it's stale.
 */
export async function fetchAndCacheThread(
  threadId: string
): ReturnType<typeof emailClient.getThread> {
  let data: InfiniteData<Thread, number> | undefined;

  const result = await catchToResult(
    async () =>
      await queryClient.fetchInfiniteQuery(threadQueryOptions(threadId))
  );

  if (result.isErr()) {
    return err(result.error as any);
  }

  data = result.value;

  const thread = flattenThreadPages(data);
  return ok({ thread: thread! });
}

type ThreadQueryData = {
  thread: Thread;
  hasMore: boolean;
};

/**
 * Query hook for fetching a thread with paginated messages.
 */
export function useThreadQuery(
  threadId: Accessor<string>
): UseInfiniteQueryResult<ThreadQueryData, Error>;
export function useThreadQuery<Options extends UseThreadQueryOptions>(
  threadId: Accessor<string>,
  options: Accessor<Options>
): UseInfiniteQueryResult<
  Extract<Options, { select: unknown }> extends never
    ? ThreadQueryData
    : ReturnType<NonNullable<Options['select']>>,
  Error
>;
export function useThreadQuery<Options extends UseThreadQueryOptions>(
  threadId: Accessor<string>,
  options?: Accessor<Options>
): UseInfiniteQueryResult<ThreadQueryData, Error> {
  return useInfiniteQuery(() => ({
    ...threadQueryOptions(threadId()),
    select: (data: InfiniteData<Thread, number>): ThreadQueryData => {
      const lastPage = data.pages.at(-1)!;
      return {
        thread: flattenThreadPages(data)!,
        hasMore: lastPage.messages.length === DEFAULT_THREAD_MESSAGES_LIMIT,
      };
    },
    ...(options?.() ?? {}),
  }));
}

type MarkThreadAsSeenParams = {
  threadId: string;
  /** Target inbox for a non-primary inbox; sent as the X-Email-Link-Id header. */
  linkId?: string;
};

/**
 * Optimistically update soup queries when marking as seen.
 * Note: We intentionally don't update the thread messages cache here.
 * Doing so triggers Suspense boundaries which unmount/remount the email view,
 * causing scroll position to reset. The is_read property isn't used in the
 * email view anyway - only the soup/list view needs it.
 */
function threadSeenOnMutate(params: MarkThreadAsSeenParams): void {
  optimisticUpdateSoupEntity({
    tag: 'emailThread',
    data: { id: params.threadId, isRead: true },
    frecency_score: 0,
  });
}

/**
 * Mutation to mark a thread as seen.
 */
export function useMarkThreadAsSeenMutation(
  callbacks?: MutationCallbacks<void, Error, MarkThreadAsSeenParams>
) {
  return useMutation(() => ({
    mutationFn: async (params: MarkThreadAsSeenParams) => {
      await throwOnErr(() =>
        emailClient.markThreadAsSeen(
          { thread_id: params.threadId },
          params.linkId
        )
      );
    },
    ...withCallbacks<void, Error, MarkThreadAsSeenParams>(
      {
        onMutate: threadSeenOnMutate,
        // Note: We intentionally don't invalidate thread messages in onSuccess.
        // The optimistic update already sets isRead in soup, and invalidating
        // thread messages triggers Suspense which resets scroll position.
      },
      callbacks
    ),
  }));
}

type MarkThreadAsUnreadParams = {
  threadId: string;
  /** The inbox (email_links row) the thread belongs to; selects that inbox's
   *  UNREAD label for multi-inbox users. */
  linkId?: string;
};

/**
 * Resolve an inbox's UNREAD system label from the cached labels list (the
 * endpoint returns every inbox's labels; mirrors trashEmails' TRASH lookup).
 */
async function fetchUnreadLabelId(linkId?: string): Promise<string> {
  const labelsData = await queryClient.fetchQuery({
    queryKey: emailKeys.labels.queryKey,
    queryFn: async () =>
      throwOnErr(async () => await emailClient.getUserLabels()),
    staleTime: 5 * 60 * 1000,
  });
  const labels = labelsData?.labels ?? [];
  const unreadLabel =
    (linkId
      ? labels.find(
          (l) => l.providerLabelId === 'UNREAD' && l.linkId === linkId
        )
      : undefined) ?? labels.find((l) => l.providerLabelId === 'UNREAD');
  if (!unreadLabel) {
    throw new Error('UNREAD label not found');
  }
  return unreadLabel.id;
}

/**
 * Optimistically flip the soup row to unread. The thread messages cache is
 * intentionally left alone for the same Suspense/scroll-reset reason as
 * threadSeenOnMutate.
 */
function threadUnreadOnMutate(params: MarkThreadAsUnreadParams): void {
  optimisticUpdateSoupEntity({
    tag: 'emailThread',
    data: { id: params.threadId, isRead: false },
    frecency_score: 0,
  });
}

/**
 * Mutation to mark a thread as unread: adds the UNREAD label to all its
 * messages — the backend also flips the thread-level flag and syncs Gmail.
 */
export function useMarkThreadAsUnreadMutation(
  callbacks?: MutationCallbacks<void, Error, MarkThreadAsUnreadParams>
) {
  return useMutation(() => ({
    mutationFn: async (params: MarkThreadAsUnreadParams) => {
      const labelId = await fetchUnreadLabelId(params.linkId);
      await throwOnErr(() =>
        emailClient.updateThreadLabel({
          thread_id: params.threadId,
          label_id: labelId,
          value: true,
        })
      );
    },
    ...withCallbacks<void, Error, MarkThreadAsUnreadParams>(
      { onMutate: threadUnreadOnMutate },
      callbacks
    ),
  }));
}

type ArchiveThreadParams = {
  threadId: string;
  archive: boolean;
  /** Target inbox for a non-primary inbox; sent as the X-Email-Link-Id header. */
  linkId?: string;
};
type ArchiveThreadContext = {
  previousData: InfiniteData<Thread, number> | undefined;
};

/** Optimistically set `inbox_visible` when archiving a thread. */
async function threadArchiveOnMutate(params: ArchiveThreadParams) {
  await queryClient.cancelQueries({
    queryKey: emailKeys.threadMessages(params.threadId).queryKey,
  });

  const previousData = queryClient.getQueryData<InfiniteData<Thread, number>>(
    emailKeys.threadMessages(params.threadId).queryKey
  );

  queryClient.setQueryData<InfiniteData<Thread, number>>(
    emailKeys.threadMessages(params.threadId).queryKey,
    (old) =>
      old && {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          inbox_visible: !params.archive,
        })),
      }
  );

  return { previousData };
}

/**
 * Cache bookkeeping for an archive/unarchive performed by another mutation
 * (e.g. the mark-done and mark-not-done actions, which issue their own
 * /archived requests): optimistically flips `inbox_visible`, rolls back if
 * the request fails, and invalidates the thread + preview queries once it
 * settles. Mirrors useUndoableArchiveThreadMutation's cache handling without
 * firing a second request or pushing an undo entry.
 */
export async function trackExternalThreadArchive(
  threadId: string,
  archived: Promise<unknown>,
  archive = true
): Promise<void> {
  const { previousData } = await threadArchiveOnMutate({
    threadId,
    archive,
  });
  try {
    await archived;
  } catch {
    if (previousData) {
      queryClient.setQueryData(
        emailKeys.threadMessages(threadId).queryKey,
        previousData
      );
    }
  } finally {
    queryClient.invalidateQueries({
      queryKey: emailKeys.threadMessages(threadId).queryKey,
    });
    queryClient.invalidateQueries({ queryKey: emailKeys.previews._def });
  }
}

/**
 * One archive/unarchive cycle for undo/redo replays: optimistic flip, API
 * call, rollback on failure, invalidate on settle. Mirrors what
 * `useUndoableArchiveThreadMutation` does through its mutation callbacks.
 */
async function replayThreadArchive(params: ArchiveThreadParams): Promise<void> {
  const { previousData } = await threadArchiveOnMutate(params);
  try {
    await throwOnErr(
      async () =>
        await emailClient.flagArchived(
          { id: params.threadId, value: params.archive },
          params.linkId
        )
    );
  } catch (err) {
    if (previousData) {
      queryClient.setQueryData(
        emailKeys.threadMessages(params.threadId).queryKey,
        previousData
      );
    }
    throw err;
  } finally {
    queryClient.invalidateQueries({
      queryKey: emailKeys.threadMessages(params.threadId).queryKey,
    });
    queryClient.invalidateQueries({ queryKey: emailKeys.previews._def });
  }
}

/**
 * Mutation to archive or unarchive a thread, with optimistic `inbox_visible`
 * handling. Each successful archive or unarchive is pushed onto the mutation
 * undo stack, and undo/redo replays the opposite call with the same
 * optimistic cache handling. Must be used inside a MutationUndoProvider.
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
    void,
    Error,
    ArchiveThreadParams,
    ArchiveThreadContext
  >(() => ({
    mutationFn: async (params: ArchiveThreadParams) => {
      await throwOnErr(
        async () =>
          await emailClient.flagArchived(
            {
              id: params.threadId,
              value: params.archive,
            },
            params.linkId
          )
      );
    },
    onMutate: async (params) => await threadArchiveOnMutate(params),
    onError: (_err, params, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(
          emailKeys.threadMessages(params.threadId).queryKey,
          context.previousData
        );
      }
      options.onError?.(params);
    },
    onSettled: (_data, _error, params) => {
      queryClient.invalidateQueries({
        queryKey: emailKeys.threadMessages(params.threadId).queryKey,
      });
      queryClient.invalidateQueries({ queryKey: emailKeys.previews._def });
    },
    undoFn: async (params) =>
      replayThreadArchive({ ...params, archive: !params.archive }),
    redoFn: async (params) => replayThreadArchive(params),
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
          analytics.track('email_message_sent');
          const threadID = data.message.thread_db_id;
          if (threadID) {
            queryClient.invalidateQueries({
              queryKey: emailKeys.threadMessages(threadID).queryKey,
            });
            // Refresh the thread's soup item so inbox views stop showing it
            // as a draft once the message is sent.
            if (!vars.skipSoupRefetch) {
              refetchSoupEntity(threadID, 'emailThread');
            }
          }
          queryClient.invalidateQueries({
            queryKey: emailKeys.previews._def,
          });
        },
      },
      callbacks
    ),
  }));
}

type ScheduleMessageParams = {
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
            send_time: vars.sendTime.toISOString(),
          })
      ),
    ...withCallbacks<UpsertScheduledResponse, Error, ScheduleMessageParams>(
      {
        onSuccess: (_data, vars) => {
          if (vars.threadID) {
            queryClient.invalidateQueries({
              queryKey: emailKeys.threadMessages(vars.threadID).queryKey,
            });
          }
          queryClient.invalidateQueries({
            queryKey: emailKeys.previews._def,
          });
        },
      },
      callbacks
    ),
  }));
}

type UnscheduleMessageParams = {
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
            },
            vars.linkId
          )
      );
    },
    ...withCallbacks<void, Error, UnscheduleMessageParams>(
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: emailKeys.previews._def,
          });
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

  toast.success('Sender blocked', {
    subtext: `All new messages will be trashed for ${senderEmail}`,
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
            toast.success('Sender unblocked');
          }
        },
      },
    ],
  });
}

async function upsertSenderFilterWithToast(
  senderEmail: string,
  isImportant: boolean
) {
  const label = isImportant ? 'Signal' : 'Noise';

  const result = await emailClient.upsertEmailFilter({
    email_address: senderEmail,
    is_important: isImportant,
  });

  if (result.isErr()) {
    toast.failure(`Failed to mark sender as ${label}`, {
      subtext: senderEmail,
    });
    return;
  }

  const filterId = result.value.filter.id;
  invalidateAllSoup();

  toast.success(`Sender marked as ${label}`, {
    subtext: `Messages from ${senderEmail} will appear in ${label}`,
    actions: [
      {
        label: 'Undo',
        icon: ArrowCounterClockwise,
        onClick: async () => {
          const undoResult = await emailClient.deleteEmailFilter({
            id: filterId,
          });
          if (undoResult.isErr()) {
            toast.failure('Failed to undo', { subtext: senderEmail });
          } else {
            invalidateAllSoup();
            toast.success('Sender filter removed');
          }
        },
      },
    ],
  });
}

export const markSenderSignalWithToast = (senderEmail: string) =>
  upsertSenderFilterWithToast(senderEmail, true);

export const markSenderNoiseWithToast = (senderEmail: string) =>
  upsertSenderFilterWithToast(senderEmail, false);
