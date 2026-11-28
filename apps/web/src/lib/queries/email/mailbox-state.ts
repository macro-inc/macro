import { optimisticMutationDispositionOf } from '@graphql-cache/exchange/optimistic';
import { Telemetry } from '@macro-inc/observability';
import {
  GroupSoupDocument,
  MailFolderSoupDocument,
  SetEmailThreadStateDocument,
  type SetEmailThreadStateInput,
  SoupDocument,
  SoupPreviewPageDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import { getActiveGraphqlSoupRevalidations } from '../soup/graphql/active-queries';

type MailboxFolderField = Extract<
  SetEmailThreadStateInput['field'],
  'JUNK' | 'TRASHED'
>;

const mailListDocuments = new Set([
  SoupDocument,
  SoupPreviewPageDocument,
  GroupSoupDocument,
  MailFolderSoupDocument,
]);

export async function setEmailMailboxFolderStates(
  threadIds: readonly string[],
  field: MailboxFolderField,
  value: boolean
): Promise<PromiseSettledResult<void>[]> {
  const context = Telemetry.captureContext();
  const client = getGraphqlSoupClient();
  // Await each foreground result with a live cache so a sibling does not
  // return as queued behind it. The network-only client can send in parallel.
  const concurrency = getGraphqlCacheHost() ? 1 : 8;
  const outcomes: PromiseSettledResult<void>[] = [];
  for (let start = 0; start < threadIds.length; start += concurrency) {
    const batch = threadIds.slice(start, start + concurrency);
    const settled = await Promise.allSettled(
      batch.map((threadId) =>
        context.run(() =>
          setEmailMailboxFolderState(client, { threadId, field, value })
        )
      )
    );
    outcomes.push(...settled);
  }
  return outcomes;
}

/** The returned thread updates local Mail membership. Server-owned lists,
 * including the list-keyed Spam and Trash pages, revalidate after replay too. */
async function setEmailMailboxFolderState(
  client: ReturnType<typeof getGraphqlSoupClient>,
  input: SetEmailThreadStateInput
) {
  const result = await client
    .mutation(
      SetEmailThreadStateDocument,
      { input },
      {
        optimisticMutation: {
          revalidations: getActiveGraphqlSoupRevalidations(client, {
            unmaintainedOnly: true,
          }).filter(({ document }) => mailListDocuments.has(document)),
        },
      }
    )
    .toPromise();
  const disposition = optimisticMutationDispositionOf(result);
  if (disposition?.kind === 'queued') return;
  if (disposition?.kind === 'permanently-failed') throw disposition.error;
  if (result.error) throw result.error;
  if (disposition?.kind === 'committed') return;
  if (!result.data?.setEmailThreadState)
    throw new Error('Email thread state mutation returned no thread');
}
