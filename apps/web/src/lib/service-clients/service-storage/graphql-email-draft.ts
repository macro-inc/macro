import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import {
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
  prependUnique,
  remove,
  select,
  update,
} from '@graphql-cache/exchange/optimistic';
import { type Client, CombinedError } from '@urql/core';
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
} from './graphql/generated/graphql';

/**
 * Input for a durable GraphQL draft save. `draftId` is the draft's handle —
 * a client-minted id (or a server id from a fetched draft) that the server
 * resolves through a caller-scoped mapping to a server-minted row, so saves
 * queued offline replay as idempotent upserts without the handle ever
 * becoming a primary key. `threadDbId` is required: this path covers reply
 * drafts, whose thread is always known.
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
 * The entity is keyed by the handle; a first save's committed response
 * arrives under the server-minted id instead. The engine skips the now
 * record-less link patch at settlement (never planting a dangling ref), so
 * the draft is briefly absent from the page until the revalidation lands —
 * subsequent saves use the adopted server id and match exactly.
 */
function optimisticDraftEntity(
  args: GraphqlSaveEmailDraftArgs
): OptimisticDraftEntity {
  const now = new Date().toISOString();
  return {
    __typename: 'GraphqlSoupEmailMessage',
    id: String(args.draftId),
    providerId: args.providerId ?? null,
    threadId: args.threadDbId,
    replyingToId: args.replyingToId != null ? String(args.replyingToId) : null,
    linkId: args.senderLinkId,
    subject: args.subject,
    snippet: null,
    internalDateTs: null,
    sentAt: null,
    isRead: true,
    isStarred: false,
    isSent: false,
    isDraft: true,
    hasAttachments: false,
    scheduledSendTime: args.sendTime ?? null,
    bodyText: args.bodyText ?? null,
    bodyHtmlSanitized: args.optimisticBodyHtml,
    bodyMacro: args.bodyMacro ?? null,
    bodyReplyless: null,
    createdAt: now,
    updatedAt: now,
    from: { email: args.senderEmail, name: null, photoUrl: null },
    to: (args.to ?? []).map(optimisticContact),
    cc: (args.cc ?? []).map(optimisticContact),
    bcc: (args.bcc ?? []).map(optimisticContact),
    labels: [],
    attachments: [],
    attachmentsDraft: [],
    attachmentsForwarded: [],
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
    ...input
  } = args;
  const variables: SaveEmailDraftMutationVariables = { input };
  const threadPageVariables: EmailThreadPageQueryVariables = {
    threadId: args.threadDbId,
    offset: 0,
    limit: DEFAULT_THREAD_MESSAGES_LIMIT,
  };
  const optimisticData: SaveEmailDraftMutation = {
    saveEmailDraft: {
      draftId: String(args.draftId),
      draft: optimisticDraftEntity(args),
      thread: {
        __typename: 'GraphqlSoupEmailThread',
        id: args.threadDbId,
        updatedAt: new Date().toISOString(),
      },
    },
  };

  const result = await executeOptimisticMutation(
    client,
    SaveEmailDraftDocument,
    variables,
    optimisticData,
    {
      uuid: crypto.randomUUID(),
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
        {
          document: EmailThreadPageDocument,
          variables: threadPageVariables,
        },
      ],
    }
  ).toPromise();

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
  const payload = result.data?.saveEmailDraft;
  if (!payload) {
    return {
      kind: 'failed',
      code: 'INTERNAL',
      error: new CombinedError({
        graphQLErrors: [new Error('draft save returned no data')],
      }),
    };
  }
  return {
    kind: 'committed',
    draftId: payload.draftId,
    threadId: payload.thread.id,
  };
}

/** Input for a durable GraphQL draft delete. */
export type GraphqlDeleteEmailDraftArgs = {
  /** The draft to delete, by its client-generated id. */
  draftId: string;
  /** Thread the draft lives in — targets the optimistic removal from the
   * thread page's message list and the post-commit revalidation. */
  threadDbId: string;
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
  const optimisticData: DeleteEmailDraftMutation = {
    deleteEmailDraft: {
      draftId: args.draftId,
      deleted: true,
      threadDeleted: false,
    },
  };

  const result = await executeOptimisticMutation(
    client,
    DeleteEmailDraftDocument,
    variables,
    optimisticData,
    {
      uuid: crypto.randomUUID(),
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
        {
          document: EmailThreadPageDocument,
          variables: threadPageVariables,
        },
      ],
    }
  ).toPromise();

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
  const payload = result.data?.deleteEmailDraft;
  if (!payload) {
    return {
      kind: 'failed',
      code: 'INTERNAL',
      error: new CombinedError({
        graphQLErrors: [new Error('draft delete returned no data')],
      }),
    };
  }
  return {
    kind: 'committed',
    deleted: payload.deleted,
    threadDeleted: payload.threadDeleted,
  };
}
