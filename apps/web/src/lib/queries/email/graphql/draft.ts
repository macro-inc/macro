import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import {
  executeOptimisticMutation,
  type OptimisticResponse,
  optimisticMutationDispositionOf,
  prependUnique,
  remove,
  select,
  update,
} from '@graphql-cache/exchange/optimistic';
import { getActiveGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import {
  DeleteEmailDraftDocument,
  type DeleteEmailDraftMutation,
  type DeleteEmailDraftMutationVariables,
  EmailThreadPageDocument,
  type EmailThreadPageQuery,
  type EmailThreadPageQueryVariables,
  type SaveEmailDraftContactInput,
  SaveEmailDraftDocument,
  type SaveEmailDraftInput,
  type SaveEmailDraftMutation,
  type SaveEmailDraftMutationVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  type AnyVariables,
  type Client,
  CombinedError,
  type OperationResult,
} from '@urql/core';
import {
  createDraftThread,
  type DraftThread,
  draftThreadIsEmpty,
  removeDraftFromThread,
  updateDraftThread,
} from './optimistic-thread';

/**
 * Input for a durable GraphQL draft save. `draftId` is the draft's handle —
 * a client-minted id (or a server id from a fetched draft) that the server
 * resolves through a caller-scoped mapping to a server-minted row, so saves
 * queued offline replay as idempotent upserts without the handle ever
 * becoming a primary key. `threadDbId` is a stable local handle for new
 * standalone drafts, or the existing conversation ID for replies.
 *
 * The `sender*` and `optimistic*` fields are client-only — they feed the
 * optimistic draft entity and are stripped from the mutation variables.
 */
export type GraphqlSaveEmailDraftArgs = Omit<
  SaveEmailDraftInput,
  'threadDbId'
> & {
  threadDbId: string;
  /** Sending inbox id for the optimistic entity's `linkId` — the input's
   * `linkId` is deliberately absent when sending from the primary inbox. */
  senderLinkId: string;
  /** Sending address for the optimistic entity's `from`. */
  senderEmail: string;
  /** Plain (non-base64) editor HTML for the optimistic entity's
   * `bodyHtmlSanitized` — responses carry that field unencoded. Unsanitized
   * until the first commit; own-content only, composed locally. */
  optimisticBodyHtml: string | null;
  /** Preserve persisted fields this body/envelope save does not modify. */
  existingDraft?: OptimisticDraftEntity;
  /** Complete cached conversation, when available. */
  existingThread?: DraftThread;
  /** Present only when this save creates a standalone local thread. */
  newThreadOwnerId?: string;
  /** Importance of this account's own draft sender. */
  senderIsSignal?: boolean;
  /** Original queue coalescing key survives adoption of server IDs. */
  mutationUuid?: string;
};

/** Maps a REST-shaped contact to the mutation's input shape. */
export function draftContactInput(contact: {
  email: string;
  name?: string | null;
  photo_url?: string | null;
}): SaveEmailDraftContactInput {
  return {
    email: contact.email,
    name: contact.name,
    photoUrl: contact.photo_url,
  };
}

/** Machine-readable failure codes set by the resolver's error taxonomy. */
export type SaveEmailDraftFailureCode =
  | 'DRAFT_ALREADY_SENT'
  | 'NOT_FOUND'
  | 'INBOX_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INVALID'
  | 'INTERNAL'
  | 'NETWORK';

/**
 * Caller-facing outcome of one draft save. Only a committed save carries a
 * server-confirmed draft ID — a queued save has not reached the server, and
 * its eventual settlement arrives through the cache host, not this promise.
 */
export type SaveEmailDraftOutcome =
  | { kind: 'committed'; draftId: string; threadId: string }
  | { kind: 'queued'; transactionId: string }
  | { kind: 'failed'; code: SaveEmailDraftFailureCode; error: CombinedError };

function failureCode(error: CombinedError): SaveEmailDraftFailureCode {
  if (error.networkError) return 'NETWORK';
  const code = error.graphQLErrors[0]?.extensions?.code;
  switch (code) {
    case 'DRAFT_ALREADY_SENT':
    case 'NOT_FOUND':
    case 'INBOX_NOT_FOUND':
    case 'UNAUTHORIZED':
    case 'INVALID':
      return code;
    default:
      return 'INTERNAL';
  }
}

/**
 * The queued / failed / no-data disposition shared by the draft mutations;
 * a resolved payload is the caller's to shape.
 */
function settleDraftMutation<TData, TVariables extends AnyVariables, Payload>(
  result: OperationResult<TData, TVariables>,
  payload: Payload | null | undefined,
  missingDataMessage: string
):
  | { kind: 'queued'; transactionId: string }
  | { kind: 'failed'; code: SaveEmailDraftFailureCode; error: CombinedError }
  | { kind: 'resolved'; payload: Payload } {
  const disposition = optimisticMutationDispositionOf(result);
  if (disposition?.kind === 'queued') {
    return { kind: 'queued', transactionId: disposition.transactionId };
  }
  if (result.error) {
    return {
      kind: 'failed',
      code: failureCode(result.error),
      error: result.error,
    };
  }
  if (!payload) {
    return {
      kind: 'failed',
      code: 'INTERNAL',
      error: new CombinedError({
        graphQLErrors: [new Error(missingDataMessage)],
      }),
    };
  }
  return { kind: 'resolved', payload };
}

type OptimisticDraftEntity = SaveEmailDraftMutation['saveEmailDraft']['draft'];
type OptimisticContact = OptimisticDraftEntity['from'];

function optimisticContact(
  contact: SaveEmailDraftContactInput
): NonNullable<OptimisticContact> {
  return {
    email: contact.email,
    name: contact.name ?? null,
    photoUrl: contact.photoUrl ?? null,
  };
}

/**
 * Fabricates the draft as a complete message entity for the optimistic
 * layer. Completeness is the invariant: the cache serves a query only when
 * every selected field of every entity resolves, so a missing field here
 * would turn the whole thread-page read into a miss — offline, that shows
 * an unloadable thread instead of one with the draft. The mutation document
 * selects the same `EmailThreadMessageFields` fragment the thread page
 * reads, so fragment drift surfaces as a compile error in this function.
 *
 * The cache binds the handle to the server identity atomically at settlement,
 * rebasing later queued edits and preserving reads through the old handle.
 */
function optimisticDraftEntity(
  args: GraphqlSaveEmailDraftArgs
): OptimisticDraftEntity {
  const now = new Date().toISOString();
  const existing = args.existingDraft;
  return {
    __typename: 'GraphqlSoupEmailMessage',
    id: String(args.draftId),
    providerId: args.providerId ?? existing?.providerId ?? null,
    threadId: args.threadDbId,
    replyingToId: args.replyingToId != null ? String(args.replyingToId) : null,
    linkId: args.senderLinkId,
    subject: args.subject,
    snippet: args.bodyText?.trim().slice(0, 200) ?? existing?.snippet ?? null,
    internalDateTs: existing?.internalDateTs ?? null,
    sentAt: existing?.sentAt ?? null,
    isRead: true,
    isStarred: existing?.isStarred ?? false,
    isSent: false,
    isDraft: true,
    hasAttachments: existing?.hasAttachments ?? false,
    scheduledSendTime: args.sendTime ?? existing?.scheduledSendTime ?? null,
    bodyText: args.bodyText ?? null,
    bodyHtmlSanitized: args.optimisticBodyHtml,
    bodyMacro: args.bodyMacro ?? null,
    bodyReplyless: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    from: { email: args.senderEmail, name: null, photoUrl: null },
    to: (args.to ?? []).map(optimisticContact),
    cc: (args.cc ?? []).map(optimisticContact),
    bcc: (args.bcc ?? []).map(optimisticContact),
    labels: existing?.labels ?? [],
    attachments: existing?.attachments ?? [],
    attachmentsDraft: existing?.attachmentsDraft ?? [],
    attachmentsForwarded: existing?.attachmentsForwarded ?? [],
  };
}

/**
 * Execute a draft save with a durable optimistic transaction. Offline (or
 * behind a blocked queue head) the mutation persists locally and replays on
 * reconnect; until it settles, the optimistic layer holds the draft as a
 * full message entity spliced into the thread page's message list — so a
 * reopened composer (or a relaunched app) sees the draft through the
 * ordinary thread read. On commit the layer is replaced by the server's
 * records, and the persisted thread-page revalidation reconciles list
 * membership and any attachment state this record cannot know.
 */
export async function executeGraphqlSaveEmailDraft(
  client: Client,
  args: GraphqlSaveEmailDraftArgs
): Promise<SaveEmailDraftOutcome> {
  // Strip the client-only fields; only schema fields may reach the wire.
  const {
    senderLinkId: _senderLinkId,
    senderEmail: _senderEmail,
    optimisticBodyHtml: _optimisticBodyHtml,
    existingDraft: _existingDraft,
    existingThread: _existingThread,
    newThreadOwnerId: _newThreadOwnerId,
    senderIsSignal: _senderIsSignal,
    mutationUuid: _mutationUuid,
    ...input
  } = args;
  const variables: SaveEmailDraftMutationVariables = { input };
  const threadPageVariables: EmailThreadPageQueryVariables = {
    threadId: args.threadDbId,
    offset: 0,
    limit: DEFAULT_THREAD_MESSAGES_LIMIT,
  };
  const draft = optimisticDraftEntity(args);
  const thread = args.existingThread
    ? updateDraftThread(args.existingThread, draft, args.senderIsSignal ?? true)
    : args.newThreadOwnerId
      ? createDraftThread(
          draft,
          args.newThreadOwnerId,
          args.senderIsSignal ?? true
        )
      : {
          __typename: 'GraphqlSoupEmailThread' as const,
          id: args.threadDbId,
          updatedAt: draft.updatedAt,
        };
  const optimisticData: OptimisticResponse<SaveEmailDraftMutation> = {
    saveEmailDraft: {
      draftId: String(args.draftId),
      draft,
      thread,
    },
  };

  const result = await executeOptimisticMutation(
    client,
    SaveEmailDraftDocument,
    variables,
    optimisticData,
    {
      // The draft handle is the coalescing key: a newer save of the same
      // draft safely replaces an older queued one (saves are full-state
      // snapshots), so an offline typing session holds one queue row per
      // draft instead of one per debounce tick. The delete reuses the key —
      // a discard supersedes any still-queued save.
      uuid: args.mutationUuid ?? String(args.draftId),
      identityBindings: [
        {
          localKey: `GraphqlSoupEmailMessage:${args.draftId}`,
          responsePath: ['saveEmailDraft', 'draft'],
          referenceFields: [
            'GraphqlSoupEmailDraftAttachment.draftId',
            'GraphqlSoupEmailForwardedAttachment.draftId',
            'GraphqlMailPreviewMessage.id',
            'GraphqlMailDraftEntry.id',
          ],
        },
        {
          localKey: `GraphqlSoupEmailThread:${args.threadDbId}`,
          responsePath: ['saveEmailDraft', 'thread'],
          referenceFields: ['GraphqlSoupEmailMessage.threadId'],
          revalidationVariables: ['threadId'],
        },
      ],
      // Splice the optimistic entity into the thread page's message list so
      // draftMap sees it. Idempotent; reapplied at commit; a non-resolving
      // path is skipped and recovered by the revalidation below.
      updates: [
        update(
          select<EmailThreadPageQuery, EmailThreadPageQueryVariables>(
            EmailThreadPageDocument,
            threadPageVariables
          )
            .field('user')
            .field('emailThread')
            .field('messages'),
          prependUnique({
            __typename: 'GraphqlSoupEmailMessage',
            id: String(args.draftId),
          })
        ),
      ],
      revalidations: [
        ...getActiveGraphqlSoupRevalidations(),
        {
          document: EmailThreadPageDocument,
          variables: threadPageVariables,
        },
      ],
    }
  ).toPromise();

  const settled = settleDraftMutation(
    result,
    result.data?.saveEmailDraft,
    'draft save returned no data'
  );
  if (settled.kind !== 'resolved') return settled;
  return {
    kind: 'committed',
    draftId: settled.payload.draftId,
    threadId: settled.payload.thread.id,
  };
}

/** Input for a durable GraphQL draft delete. */
export type GraphqlDeleteEmailDraftArgs = {
  /** The draft to delete, by its client-generated id. */
  draftId: string;
  /** Thread the draft lives in — targets the optimistic removal from the
   * thread page's message list and the post-commit revalidation. */
  threadDbId: string;
  existingThread?: DraftThread;
  mutationUuid?: string;
};

/**
 * Caller-facing outcome of one draft delete. `committed.deleted` is false
 * when the server found nothing to delete — the delete is idempotent, so
 * that is success, not an error.
 */
export type DeleteEmailDraftOutcome =
  | { kind: 'committed'; deleted: boolean; threadDeleted: boolean }
  | { kind: 'queued'; transactionId: string }
  | { kind: 'failed'; code: SaveEmailDraftFailureCode; error: CombinedError };

/**
 * Execute a draft delete with a durable optimistic transaction. Offline the
 * mutation persists locally and replays on reconnect — strictly after any
 * queued saves of the same draft, so save-then-discard converges to no
 * draft. Until it settles, the optimistic layer removes the draft from the
 * thread page's message list, so a reopened thread (or relaunched app) no
 * longer shows it. The server delete is idempotent: replaying after the
 * draft is already gone succeeds as a no-op.
 */
export async function executeGraphqlDeleteEmailDraft(
  client: Client,
  args: GraphqlDeleteEmailDraftArgs
): Promise<DeleteEmailDraftOutcome> {
  const variables: DeleteEmailDraftMutationVariables = {
    input: { draftId: args.draftId },
  };
  const threadPageVariables: EmailThreadPageQueryVariables = {
    threadId: args.threadDbId,
    offset: 0,
    limit: DEFAULT_THREAD_MESSAGES_LIMIT,
  };
  const thread = args.existingThread
    ? removeDraftFromThread(args.existingThread, args.draftId)
    : undefined;
  const optimisticData: OptimisticResponse<DeleteEmailDraftMutation> = {
    deleteEmailDraft: {
      draftId: args.draftId,
      deleted: true,
      threadDeleted: thread ? draftThreadIsEmpty(thread) : false,
      threadId: args.threadDbId,
      thread,
    },
  };

  const result = await executeOptimisticMutation(
    client,
    DeleteEmailDraftDocument,
    variables,
    optimisticData,
    {
      // Same coalescing key as the draft's saves: a discard supersedes any
      // still-queued save of this draft — the replaced entry never replays,
      // and the delete itself is an idempotent no-op if nothing was created.
      uuid: args.mutationUuid ?? args.draftId,
      identityBindings: [
        {
          localKey: `GraphqlSoupEmailMessage:${args.draftId}`,
          responsePath: [],
          deleteRecord: true,
          referenceFields: [
            'GraphqlMailPreviewMessage.id',
            'GraphqlMailDraftEntry.id',
          ],
        },
        {
          localKey: `GraphqlSoupEmailThread:${args.threadDbId}`,
          responsePath: [],
          referenceFields: ['GraphqlSoupEmailMessage.threadId'],
          revalidationVariables: ['threadId'],
        },
      ],
      // Drop the draft from the thread page's message list so draftMap
      // stops seeing it. Idempotent; reapplied at commit; a non-resolving
      // path is skipped and recovered by the revalidation below.
      updates: [
        update(
          select<EmailThreadPageQuery, EmailThreadPageQueryVariables>(
            EmailThreadPageDocument,
            threadPageVariables
          )
            .field('user')
            .field('emailThread')
            .field('messages'),
          remove({
            __typename: 'GraphqlSoupEmailMessage',
            id: args.draftId,
          })
        ),
      ],
      revalidations: [
        ...getActiveGraphqlSoupRevalidations(),
        {
          document: EmailThreadPageDocument,
          variables: threadPageVariables,
        },
      ],
    }
  ).toPromise();

  const settled = settleDraftMutation(
    result,
    result.data?.deleteEmailDraft,
    'draft delete returned no data'
  );
  if (settled.kind !== 'resolved') return settled;
  return {
    kind: 'committed',
    deleted: settled.payload.deleted,
    threadDeleted: settled.payload.threadDeleted,
  };
}
