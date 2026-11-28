import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { optimisticMutationDispositionOf } from '@graphql-cache/exchange/optimistic';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import {
  GroupSoupDocument,
  MailFolderSoupDocument,
  SetEmailThreadFolderStatesDocument,
  type SetEmailThreadFolderStatesInput,
  SoupDocument,
  SoupPreviewPageDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import { ReactiveMap } from '@solid-primitives/map';
import { queryAccountSession } from '../auth/account-scope';
import { getActiveGraphqlSoupRevalidations } from '../soup/graphql/active-queries';

const FOLDER_BATCH_SIZE = 32;

const mailListDocuments = new Set([
  SoupDocument,
  SoupPreviewPageDocument,
  GroupSoupDocument,
  MailFolderSoupDocument,
]);

const pendingTrash = new ReactiveMap<
  string,
  { session: number; keys: string[] }
>();

export function pendingEmailTrashKeys(): ReadonlySet<string> {
  const session = queryAccountSession();
  return new Set(
    [...pendingTrash.values()]
      .filter((entry) => entry.session === session)
      .flatMap((entry) => entry.keys)
  );
}

/** Keep older network pages from showing a thread while its trash is pending.
 * The normalized reply owns membership once the write settles. */
function holdTrashVisibility(
  uuid: string,
  threadIds: SetEmailThreadFolderStatesInput['threadIds']
) {
  const host = getGraphqlCacheHost();
  pendingTrash.set(uuid, {
    session: queryAccountSession(),
    keys: threadIds.map((id) => `GraphqlSoupEmailThread:${id}`),
  });

  const release = () => {
    unsubscribeSettlement?.();
    unsubscribeGeneration?.();
    pendingTrash.delete(uuid);
  };
  const unsubscribeSettlement = host?.onMutationSettled((settlement) => {
    if (settlement.mutationUuid === uuid) release();
  });
  const unsubscribeGeneration = host?.onCacheGenerationChanged((change) => {
    if (change.queue === 'reset') release();
  });
  return release;
}

export async function setEmailMailboxFolderStates(
  threadIds: readonly string[],
  field: SetEmailThreadFolderStatesInput['field'],
  value: boolean
): Promise<PromiseSettledResult<void>[]> {
  const context = Telemetry.captureContext();
  const client = getGraphqlSoupClient();
  const outcomes: PromiseSettledResult<void>[] = [];
  for (let start = 0; start < threadIds.length; start += FOLDER_BATCH_SIZE) {
    const batch = threadIds.slice(start, start + FOLDER_BATCH_SIZE);
    try {
      const settled = await context.run(() =>
        setEmailMailboxFolderState(
          client,
          { threadIds: batch, field, value },
          context
        )
      );
      outcomes.push(...settled);
    } catch (reason) {
      outcomes.push(
        ...batch.map(() => ({ status: 'rejected' as const, reason }))
      );
    }
  }
  return outcomes;
}

/** The returned thread updates local Mail membership. Server-owned lists,
 * including the list-keyed Spam and Trash pages, revalidate after replay too. */
async function setEmailMailboxFolderState(
  client: ReturnType<typeof getGraphqlSoupClient>,
  input: SetEmailThreadFolderStatesInput,
  trace: TraceContext
): Promise<PromiseSettledResult<void>[]> {
  const uuid =
    input.field === 'TRASHED' && input.value ? crypto.randomUUID() : undefined;
  const release = uuid && holdTrashVisibility(uuid, input.threadIds);
  let queued = false;
  try {
    const result = await client
      .mutation(
        SetEmailThreadFolderStatesDocument,
        { input },
        {
          [TRACE_PARENT_CONTEXT_KEY]: trace,
          optimisticMutation: {
            uuid,
            revalidations: getActiveGraphqlSoupRevalidations(client, {
              unmaintainedOnly: true,
            }).filter(({ document }) => mailListDocuments.has(document)),
          },
        }
      )
      .toPromise();
    const disposition = optimisticMutationDispositionOf(result);
    queued = disposition?.kind === 'queued';
    // Admission is the caller's receipt. Replay settles each thread independently.
    if (queued)
      return input.threadIds.map(() => ({
        status: 'fulfilled',
        value: undefined,
      }));
    if (disposition?.kind === 'permanently-failed') throw disposition.error;
    if (result.error) throw result.error;
    const acknowledged = new Map(
      result.data?.setEmailThreadFolderStates.map((thread) => [
        String(thread.threadId),
        thread,
      ])
    );
    return input.threadIds.map((id) => {
      const thread = acknowledged.get(String(id));
      if (!thread || thread.error)
        return {
          status: 'rejected',
          reason: new Error(
            thread?.error ?? 'Mailbox write was not acknowledged'
          ),
        };
      return { status: 'fulfilled', value: undefined };
    });
  } finally {
    if (!queued && release) release();
  }
}
