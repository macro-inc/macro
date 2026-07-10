import { useAnalytics } from '@app/component/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import { catchToResult, throwOnErr } from '@core/util/result';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { authKeys, type UserInfoData } from '@queries/auth/user-info';
import { emailClient } from '@service-email/client';
import type {
  ApiDraftInput,
  ApiMessage,
  SendMessageResponse,
  ApiThread as Thread,
  UpsertScheduledResponse,
} from '@service-email/generated/schemas';
import {
  type GraphqlEmailThreadPreload,
  getGraphqlEmailThreadPreload,
} from '@service-storage/graphql-soup';
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
function threadQueryOptions(threadId: string) {
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

function mapPreloadedContact(
  contact: GraphqlEmailThreadPreload['message']['to'][number]
) {
  return {
    email: contact.email,
    name: contact.name,
    photo_url: contact.photoUrl,
  };
}

function mapPreloadedMessage(preload: GraphqlEmailThreadPreload): ApiMessage {
  const { message } = preload;
  return {
    attachments: preload.attachments.map((attachment) => ({
      content_id: attachment.contentId,
      db_id: attachment.id,
      filename: attachment.filename,
      mime_type: attachment.mimeType,
      provider_id: attachment.providerAttachmentId,
      size_bytes: attachment.sizeBytes,
    })),
    attachments_draft: [],
    attachments_forwarded: [],
    bcc: message.bcc.map(mapPreloadedContact),
    body_html_sanitized: message.bodyHtmlSanitized,
    body_replyless: message.bodyReplyless,
    body_text: message.bodyText,
    cc: message.cc.map(mapPreloadedContact),
    created_at: message.createdAt,
    db_id: message.id,
    from: message.from ? mapPreloadedContact(message.from) : null,
    has_attachments: message.hasAttachments,
    internal_date_ts: message.internalDateTs,
    is_draft: false,
    is_read: message.isRead,
    is_sent: message.isSent,
    is_starred: message.isStarred,
    labels: message.labels.map((label) => ({
      created_at: label.createdAt,
      id: label.id,
      label_list_visibility:
        label.labelListVisibility === 'LabelShow' ||
        label.labelListVisibility === 'LabelShowIfUnread' ||
        label.labelListVisibility === 'LabelHide'
          ? label.labelListVisibility
          : null,
      link_id: label.linkId,
      message_list_visibility:
        label.messageListVisibility === 'Show' ||
        label.messageListVisibility === 'Hide'
          ? label.messageListVisibility
          : null,
      name: label.name,
      provider_label_id: label.providerLabelId,
      type_:
        label.type === 'System' || label.type === 'User' ? label.type : null,
    })),
    link_id: message.linkId,
    sent_at: message.sentAt,
    snippet: message.snippet,
    subject: message.subject,
    thread_db_id: message.threadId,
    to: message.to.map(mapPreloadedContact),
    updated_at: message.updatedAt,
  };
}

function mapPreloadedThread(preload: GraphqlEmailThreadPreload): Thread {
  const { message, thread } = preload;
  const accessLevel = (() => {
    switch (message.accessLevel) {
      case 'owner':
      case 'edit':
      case 'comment':
      case 'view':
        return message.accessLevel;
      default:
        return 'view';
    }
  })();
  return {
    access_level: accessLevel,
    created_at: thread.createdAt,
    db_id: thread.id,
    inbox_visible: thread.inboxVisible,
    is_read: thread.isRead,
    link_id: message.linkId,
    messages: [mapPreloadedMessage(preload)],
    project_id: thread.projectId,
    provider_id: thread.providerId,
    updated_at: thread.updatedAt,
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

  const queryKey = emailKeys.threadMessages(threadId).queryKey;
  const cached =
    queryClient.getQueryData<InfiniteData<Thread, number>>(queryKey);
  const userInfo = queryClient.getQueryData<UserInfoData>(
    authKeys.userInfo.queryKey
  );
  const preload =
    cached || userInfo?.authenticated !== true
      ? undefined
      : getGraphqlEmailThreadPreload(threadId, userInfo.id);
  if (preload) {
    const thread = mapPreloadedThread(preload);
    queryClient.setQueryData<InfiniteData<Thread, number>>(
      queryKey,
      { pages: [thread], pageParams: [0] },
      { updatedAt: 0 }
    );
    void queryClient.prefetchInfiniteQuery(threadQueryOptions(threadId));
    return ok({ thread });
  }

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
 * Mutation to archive or unarchive a thread.
 * Uses optimistic updates to immediately reflect the change in UI.
 */
export function useArchiveThreadMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    ArchiveThreadParams,
    ArchiveThreadContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (params: ArchiveThreadParams) =>
      void throwOnErr(
        async () =>
          await emailClient.flagArchived(
            {
              id: params.threadId,
              value: params.archive,
            },
            params.linkId
          )
      ),
    ...withCallbacks<void, Error, ArchiveThreadParams, ArchiveThreadContext>(
      {
        onMutate: async (params) => await threadArchiveOnMutate(params),
        onError: (_err, params, context) => {
          if (context?.previousData) {
            queryClient.setQueryData(
              emailKeys.threadMessages(params.threadId).queryKey,
              context.previousData
            );
          }
        },
        onSettled: (_data, _error, params) => {
          queryClient.invalidateQueries({
            queryKey: emailKeys.threadMessages(params.threadId).queryKey,
          });
          queryClient.invalidateQueries({ queryKey: emailKeys.previews._def });
        },
      },
      callbacks
    ),
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
