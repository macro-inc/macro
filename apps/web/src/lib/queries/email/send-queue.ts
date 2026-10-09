import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import { decodeBase64Bytes } from '@core/util/base64';
import {
  type DurableMutationIntent,
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
} from '@graphql-cache/exchange/optimistic';
import { getBrowserTursoCacheRolloutDecision } from '@graphql-cache/rollout';
import {
  CancelEmailSendDocument,
  EmailSendAttemptDocument,
  type EmailSendAttemptFieldsFragment,
  EmailThreadPageDocument,
  SendEmailMessageDocument,
  type SendEmailMessageInput,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import { getActiveGraphqlSoupRevalidations } from '../soup/graphql/active-queries';
import { publishDraftRestoration } from './draft-lifecycle-events';
import { readCachedDraftAndThread, saveEmailDraftQueued } from './draft-queue';
import {
  type GraphqlSaveEmailDraftArgs,
  optimisticDraftEntity,
} from './graphql/draft';
import {
  createDraftThread,
  updateDraftThread,
} from './graphql/optimistic-thread';
import {
  persistLocalEmailSend,
  readLocalEmailSends,
  removeLocalEmailSend,
  watchLocalEmailSends,
} from './local-drafts';
import {
  captureSendWorkingCopy,
  restoreSendWorkingCopy,
  retireSendWorkingCopy,
  type SendRestorationVersion,
  type SendWorkingCopy,
} from './send-draft-lifecycle';

/** Initialization failure must not bypass sends persisted by a previous session. */
export function emailSendQueueSelected(
  transport?: 'graphql' | 'rest'
): boolean {
  return (
    (transport
      ? transport === 'graphql'
      : isFeatureEnabled(enableGraphqlSoup)) &&
    (graphqlCacheEnabled() || getBrowserTursoCacheRolloutDecision().enabled)
  );
}

/** Persisted independently of the optimistic layer, including after rejection. */
export type EmailSendIntent = {
  uuid: string;
  cancellationRequested?: boolean;
  /** The disposable cache lost this record; reconcile before replaying it. */
  cacheMissing?: boolean;
  /** Resolved through cache aliases on each durable journal read. */
  resolvedDraftId?: string;
  resolvedThreadId?: string;
  phase: 'pending' | 'committed' | 'failed';
  locallyCancelled: boolean;
  metadata: {
    kind: 'email-send-v1';
    replace?: boolean;
    exclusive?: DurableMutationIntent['exclusive'];
    payload: {
      restoring?: boolean;
      restorationVersion?: SendRestorationVersion;
      workingCopy?: SendWorkingCopy;
      input: SendEmailMessageInput;
      draft: GraphqlSaveEmailDraftArgs;
    };
  };
  response?: {
    sendEmailMessage?: { attempt: EmailSendAttemptFieldsFragment };
    cancelEmailSend?: { attempt: EmailSendAttemptFieldsFragment };
  } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEmailSendIntent(value: unknown): value is EmailSendIntent {
  if (
    !isRecord(value) ||
    typeof value.uuid !== 'string' ||
    !['pending', 'committed', 'failed'].includes(String(value.phase))
  )
    return false;
  const metadata = value.metadata;
  if (
    !isRecord(metadata) ||
    metadata.kind !== 'email-send-v1' ||
    !isRecord(metadata.payload)
  )
    return false;
  const { input, draft } = metadata.payload;
  return (
    isRecord(input) &&
    isRecord(input.attempt) &&
    typeof input.attempt.attemptId === 'string' &&
    typeof input.attempt.linkId === 'string' &&
    isRecord(input.message) &&
    typeof input.message.draftId === 'string' &&
    typeof input.message.subject === 'string' &&
    isRecord(draft) &&
    typeof draft.threadDbId === 'string' &&
    typeof draft.senderEmail === 'string'
  );
}

export function settledSendAttempt(intent: EmailSendIntent) {
  return (
    intent.response?.cancelEmailSend?.attempt ??
    intent.response?.sendEmailMessage?.attempt
  );
}

/** A pending cancellation never unlocks an attempted send without confirmation. */
export function emailSendLocked(intent: EmailSendIntent): boolean {
  if (intent.locallyCancelled || intent.metadata.payload.restoring)
    return false;
  return settledSendAttempt(intent)?.status !== 'CANCELLED';
}

export function emailSendMatchesDraft(
  intent: EmailSendIntent,
  draftId: string
): boolean {
  return (
    intent.resolvedDraftId === draftId ||
    intent.metadata.payload.input.message.draftId === draftId ||
    settledSendAttempt(intent)?.message?.id === draftId
  );
}

export async function readEmailSendIntents(): Promise<EmailSendIntent[]> {
  getGraphqlSoupClient();
  const host = getGraphqlCacheHost();
  if (!host || host.disabled)
    throw new Error('Durable email storage is unavailable');
  const backups = await readLocalEmailSends();
  const entries = await host.durableMutationIntents();
  const cached = entries.filter(isEmailSendIntent);
  const rows: EmailSendIntent[] = [];
  for (const intent of cached) {
    const identities = await readCachedDraftAndThread(
      String(intent.metadata.payload.input.message.draftId),
      intent.metadata.payload.draft.threadDbId,
      entries
    );
    const backup = backups.find((row) => row.uuid === intent.uuid);
    let next: EmailSendIntent = {
      ...intent,
      resolvedDraftId: String(identities.draftId),
      resolvedThreadId: identities.threadDbId,
      cancellationRequested: backup?.cancellationRequested,
    };
    // Only persist real changes: writing on every observation would notify forever.
    if (
      !(
        backup?.metadata.payload.restoring && !next.metadata.payload.restoring
      ) &&
      (!backup ||
        JSON.stringify({ ...backup, cacheMissing: undefined }) !==
          JSON.stringify(next))
    )
      next = await persistLocalEmailSend(next);
    rows.push(
      backup?.metadata.payload.restoring && !next.metadata.payload.restoring
        ? backup
        : next
    );
  }
  for (const backup of backups)
    if (!cached.some((row) => row.uuid === backup.uuid))
      rows.push({ ...backup, cacheMissing: true });
  return rows;
}

export function watchEmailSends(changed: () => void): () => void {
  getGraphqlSoupClient();
  const cache = getGraphqlCacheHost()?.onCacheChanged(changed);
  const local = watchLocalEmailSends(changed);
  return () => {
    cache?.();
    local();
  };
}

export async function sendEmailQueued(args: {
  draft: GraphqlSaveEmailDraftArgs;
  expectedLocalVersion?: Pick<SendWorkingCopy, 'generation' | 'revision'>;
  attachmentIds: string[];
  forwardedAttachmentIds: string[];
  includeSignature?: boolean | null;
  restoreBodyHtml?: string | null;
  restoreBodyText?: string | null;
  restoreBodyMacro?: string | null;
}) {
  const host = getGraphqlCacheHost();
  if (!host || host.disabled)
    throw new Error('Durable email storage is unavailable');
  const previous = (await readEmailSendIntents()).find(
    (intent) =>
      emailSendMatchesDraft(intent, String(args.draft.draftId)) &&
      emailSendLocked(intent)
  );
  if (previous) throw new Error('This draft is already queued for sending');
  const cached = await readCachedDraftAndThread(
    String(args.draft.draftId),
    args.draft.threadDbId
  );
  const draft = { ...args.draft, ...cached };
  const workingCopy = await captureSendWorkingCopy(
    String(args.draft.draftId),
    args.attachmentIds,
    args.forwardedAttachmentIds,
    args.expectedLocalVersion
  );
  const attemptId = crypto.randomUUID();
  const input: SendEmailMessageInput = {
    attempt: { attemptId, linkId: draft.senderLinkId },
    message: {
      draftId: draft.draftId,
      threadDbId: draft.threadDbId,
      subject: draft.subject,
      linkId: draft.senderLinkId,
      replyingToId: draft.replyingToId,
      providerId: draft.providerId,
      providerThreadId: draft.providerThreadId,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      bodyHtml: draft.bodyHtml,
      bodyText: draft.bodyText,
      bodyMacro: draft.bodyMacro,
    },
    attachmentIds: args.attachmentIds,
    forwardedAttachmentIds: args.forwardedAttachmentIds,
    includeSignature: args.includeSignature,
    restoreBodyHtml: args.restoreBodyHtml ?? draft.bodyHtml,
    restoreBodyText: args.restoreBodyText ?? draft.bodyText,
    restoreBodyMacro: args.restoreBodyMacro ?? draft.bodyMacro,
  };
  const intent: EmailSendIntent = {
    uuid: attemptId,
    phase: 'pending',
    locallyCancelled: false,
    metadata: {
      kind: 'email-send-v1',
      payload: { input, draft, workingCopy },
      exclusive: {
        entityKey: `GraphqlSoupEmailMessage:${draft.draftId}`,
        releaseOn: {
          responsePath: ['cancelEmailSend', 'attempt', 'status'],
          value: 'CANCELLED',
        },
      },
    },
  };
  await persistLocalEmailSend(intent, true);
  return await enqueueEmailSendIntent(intent);
}

async function enqueueEmailSendIntent(intent: EmailSendIntent) {
  const { input, draft } = intent.metadata.payload;
  const attemptId = intent.uuid;
  const message = optimisticDraftEntity(draft);
  const thread = draft.existingThread
    ? updateDraftThread(
        draft.existingThread,
        message,
        draft.senderIsSignal ?? true
      )
    : draft.newThreadOwnerId
      ? createDraftThread(
          message,
          draft.newThreadOwnerId,
          draft.senderIsSignal ?? true
        )
      : undefined;
  const result = await executeOptimisticMutation(
    getGraphqlSoupClient(),
    SendEmailMessageDocument,
    { input },
    {
      sendEmailMessage: {
        attempt: {
          attemptId,
          status: 'ACCEPTED',
          sendTime: null,
          threadId: draft.threadDbId,
          message,
        },
        thread,
      },
    },
    {
      uuid: attemptId,
      durableIntent: {
        ...intent.metadata,
      },
      identityBindings: [
        {
          localKey: `GraphqlSoupEmailMessage:${draft.draftId}`,
          responsePath: ['sendEmailMessage', 'attempt', 'message'],
          referenceFields: [
            'GraphqlMailDraftEntry.id',
            'GraphqlMailPreviewMessage.id',
          ],
        },
        {
          localKey: `GraphqlSoupEmailThread:${draft.threadDbId}`,
          responsePath:
            draft.existingThread?.cacheProjection === null ||
            draft.newThreadOwnerId
              ? ['sendEmailMessage', 'thread']
              : [],
          referenceFields: ['GraphqlSoupEmailMessage.threadId'],
          revalidationVariables: ['threadId'],
        },
      ],
      revalidations: sendRevalidations(draft.threadDbId),
    }
  ).toPromise();
  const queued = optimisticMutationDispositionOf(result)?.kind === 'queued';
  if (result.error && !queued) throw result.error;

  const attempt = result.data?.sendEmailMessage.attempt;
  return {
    draftId: attempt?.message?.id ?? String(draft.draftId),
    threadId: attempt?.threadId ?? draft.threadDbId,
    inboxId: draft.senderLinkId,
    sendAttemptId: attemptId,
    persistence: queued ? ('queued' as const) : ('committed' as const),
  };
}

function sendRevalidations(threadId: string) {
  return [
    ...getActiveGraphqlSoupRevalidations(),
    {
      document: EmailThreadPageDocument,
      variables: { threadId, offset: 0, limit: DEFAULT_THREAD_MESSAGES_LIMIT },
    },
  ];
}

/** Replaces the send request atomically, fencing any previously issued network claim. */
export class EmailSendCancellationTooLate extends Error {
  constructor() {
    super('Delivery already started; cancellation was too late');
    this.name = 'EmailSendCancellationTooLate';
  }
}

export class EmailSendDeliveryUnconfirmed extends Error {
  constructor() {
    super(
      'Delivery unconfirmed; check your sent mail. We will not resend automatically.'
    );
    this.name = 'EmailSendDeliveryUnconfirmed';
  }
}

/** Returns persisted state independently of any mounted queue observer. */
export async function cancelEmailSendQueued(
  intent: EmailSendIntent
): Promise<EmailSendIntent> {
  if (settledSendAttempt(intent)?.status === 'DELIVERY_UNCONFIRMED')
    throw new EmailSendDeliveryUnconfirmed();
  intent = { ...intent, cancellationRequested: true };
  await persistLocalEmailSend(intent);
  const { input, draft } = intent.metadata.payload;
  const result = await executeOptimisticMutation(
    getGraphqlSoupClient(),
    CancelEmailSendDocument,
    { input: input.attempt },
    {
      cancelEmailSend: {
        attempt: {
          attemptId: intent.uuid,
          status: 'ACCEPTED',
          sendTime: null,
          threadId: draft.threadDbId,
          message: optimisticDraftEntity({
            ...draft,
            bodyHtml: input.restoreBodyHtml,
            bodyText: input.restoreBodyText,
            bodyMacro: input.restoreBodyMacro,
            optimisticBodyHtml: input.restoreBodyHtml
              ? new TextDecoder().decode(
                  decodeBase64Bytes(input.restoreBodyHtml)
                )
              : null,
          }),
        },
        thread: draft.existingThread,
      },
    },
    {
      uuid: intent.uuid,
      durableIntent: { ...intent.metadata, replace: true },
      revalidations: sendRevalidations(draft.threadDbId),
    }
  ).toPromise();
  if (optimisticMutationDispositionOf(result)?.kind !== 'queued') {
    if (result.error) throw result.error;
    const status = result.data?.cancelEmailSend.attempt.status;
    if (status === 'DELIVERY_UNCONFIRMED')
      throw new EmailSendDeliveryUnconfirmed();
    if (status === 'SENDING' || status === 'SENT')
      throw new EmailSendCancellationTooLate();
  }
  const updated = (await readEmailSendIntents()).find(
    (row) => row.uuid === intent.uuid
  );
  if (!updated) throw new Error('This send is no longer available to undo');
  return updated;
}

/** Status reconciliation never resubmits a send or creates another attempt. */
export async function fetchEmailSendStatus(intent: EmailSendIntent) {
  const result = await getGraphqlSoupClient()
    .query(
      EmailSendAttemptDocument,
      { input: intent.metadata.payload.input.attempt },
      { requestPolicy: 'network-only' }
    )
    .toPromise();
  if (result.error) throw result.error;
  return result.data?.user.emailSendAttempt ?? null;
}

/** Restore the existing draft identity so uploaded and forwarded files stay attached. */
export async function restoreCancelledEmailSend(
  intent: EmailSendIntent
): Promise<void> {
  if (emailSendLocked(intent))
    throw new Error('Confirm cancellation before restoring the draft');
  const { draft, input } = intent.metadata.payload;
  // Persist restoration authority before saving a replacement working copy.
  await persistLocalEmailSend({
    ...intent,
    phase: 'pending',
    response: undefined,
    metadata: {
      ...intent.metadata,
      exclusive: undefined,
      payload: {
        ...intent.metadata.payload,
        restoring: true,
        draft: {
          ...draft,
          bodyHtml: input.restoreBodyHtml,
          bodyText: input.restoreBodyText,
          bodyMacro: input.restoreBodyMacro,
        },
      },
    },
  });
  const { restorationVersion, ...restored } = await restoreSendWorkingCopy(
    {
      ...draft,
      bodyHtml: input.restoreBodyHtml,
      bodyText: input.restoreBodyText,
      bodyMacro: input.restoreBodyMacro,
    },
    intent.metadata.payload.workingCopy
  );
  const restoredIntent: EmailSendIntent = {
    ...intent,
    phase: 'pending',
    response: undefined,
    metadata: {
      ...intent.metadata,
      exclusive: undefined,
      replace: true,
      payload: {
        ...intent.metadata.payload,
        draft: restored,
        restoring: true,
        restorationVersion,
      },
    },
  };
  await persistLocalEmailSend(restoredIntent);
  const outcome = await saveEmailDraftQueued({
    args: {
      ...restored,
      mutationUuid: intent.uuid,
      durableIntent: {
        ...intent.metadata,
        exclusive: undefined,
        replace: true,
        payload: {
          ...intent.metadata.payload,
          draft: restored,
          restoring: true,
          restorationVersion,
        },
      },
    },
  });
  if (outcome.kind === 'rejected')
    throw new Error(
      'Unable to restore the draft. Your message is still saved in the send queue.'
    );
  publishDraftRestoration({
    draftId:
      outcome.kind === 'committed'
        ? outcome.draftId
        : (intent.resolvedDraftId ?? String(draft.draftId)),
    inboxId: draft.senderLinkId,
    restoration: {
      originalDraftId: String(draft.draftId),
      threadId:
        outcome.kind === 'committed'
          ? outcome.threadId
          : (intent.resolvedThreadId ?? draft.threadDbId),
      replyingToId:
        input.message.replyingToId == null
          ? undefined
          : String(input.message.replyingToId),
      includeSignature: input.includeSignature,
    },
  });
}

/** The observer retires success or a restoration superseded by an acknowledged edit. */
export async function retireEmailSendIntent(
  intent: EmailSendIntent
): Promise<boolean> {
  const retired = await getGraphqlCacheHost()?.retireDurableMutationIntent(
    intent.uuid
  );
  if (!retired && !intent.cacheMissing) return false;
  if (!intent.metadata.payload.restoring)
    await retireSendWorkingCopy(intent.metadata.payload.workingCopy);
  await removeLocalEmailSend(intent.uuid);
  return true;
}

/** A cache rebuild reuses the original idempotency key and honors durable cancellation. */
export async function recoverEmailSendIntent(
  intent: EmailSendIntent
): Promise<void> {
  if (!intent.cacheMissing) return;
  if (intent.metadata.payload.restoring) {
    if (!intent.metadata.payload.restorationVersion) {
      await restoreCancelledEmailSend(intent);
      return;
    }
    const outcome = await saveEmailDraftQueued({
      args: {
        ...intent.metadata.payload.draft,
        mutationUuid: intent.uuid,
        durableIntent: { ...intent.metadata, replace: true },
      },
    });
    if (outcome.kind === 'rejected')
      throw new Error('Unable to recover the restored draft');
    return;
  }
  const attempt = await fetchEmailSendStatus(intent);
  if (attempt) {
    const reconciled = {
      ...intent,
      response: { sendEmailMessage: { attempt } },
    };
    await persistLocalEmailSend(reconciled);
    if (attempt.status === 'SENT') {
      await retireEmailSendIntent(reconciled);
      return;
    }
    if (
      attempt.status === 'CANCELLED' ||
      attempt.status === 'DELIVERY_UNCONFIRMED'
    )
      return;
  }
  if (intent.phase === 'failed' && !intent.cancellationRequested) return;
  if (intent.cancellationRequested) await cancelEmailSendQueued(intent);
  else await enqueueEmailSendIntent(intent);
}
