import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { documentOperationName } from '@graphql-cache/exchange/generated-selection';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry } from '@macro-inc/observability';
import type { Exchange, OperationResult } from '@urql/core';
import { fromPromise, fromValue, mergeMap, pipe } from 'wonka';
import {
  RecoverEmailThreadFolderRowDocument,
  type SetEmailThreadFolderStatesMutation,
} from './graphql/generated/graphql';

/** Recover the Mail row for an acknowledged folder write before the queue
 * settles. Runs for live mutations and for writes replayed from durable data. */
export const emailMailboxEffectsExchange: Exchange = ({ client, forward }) => {
  async function recover(
    result: OperationResult<SetEmailThreadFolderStatesMutation>
  ) {
    const rows = result.data?.setEmailThreadFolderStates;
    if (!rows || result.error?.networkError) return result;

    const missing = new Set<number>();
    for (const { path } of result.error?.graphQLErrors ?? []) {
      const index = path?.[1];
      if (
        path?.[0] !== 'setEmailThreadFolderStates' ||
        path[2] !== 'effect' ||
        typeof index !== 'number' ||
        rows[index]?.error !== null
      )
        return result;
      missing.add(index);
    }
    for (const [index, row] of rows.entries()) {
      if (!row.error && !row.effect) missing.add(index);
    }
    if (missing.size === 0) return result;

    const generation = result.operation.context.cacheSessionGeneration;
    const trace = result.operation.context[TRACE_PARENT_CONTEXT_KEY];
    const recovered = [...rows];
    const indices = [...missing];
    const repair = () =>
      Telemetry.span('email.folder.row_recovery', async (span) => {
        span.setAttr('email.thread.count', indices.length);
        for (let start = 0; start < indices.length; start += 4) {
          await Promise.all(
            indices.slice(start, start + 4).map(async (index) => {
              const row = rows[index];
              recovered[index] = { ...row, effect: null };
              if (
                typeof generation === 'string' &&
                !cacheSessionGeneration.isCurrent(generation)
              )
                return;

              try {
                const repair = await client
                  .query(
                    RecoverEmailThreadFolderRowDocument,
                    { threadId: row.threadId },
                    {
                      requestPolicy: 'network-only',
                      [TRACE_PARENT_CONTEXT_KEY]: span,
                    }
                  )
                  .toPromise();
                const effect = repair.data?.user?.soupEntity;
                if (
                  !repair.error &&
                  effect?.__typename === 'GraphqlSoupEmailThread' &&
                  effect.id === row.threadId
                )
                  recovered[index] = { ...row, effect };
                else if (repair.error)
                  span.error('Mailbox row recovery failed');
              } catch {
                span.error('Mailbox row recovery failed');
              }
            })
          );
        }
      });
    // Only errors under acknowledged effects are swallowed. A failed repair
    // still leaves the server acknowledgement available for bulk compensation.
    if (trace) await trace.run(repair);
    else await repair();
    return {
      ...result,
      error: undefined,
      data: { setEmailThreadFolderStates: recovered },
    };
  }

  return (operations$) =>
    pipe(
      forward(operations$),
      mergeMap((result) =>
        result.operation.kind === 'mutation' &&
        documentOperationName(result.operation.query) ===
          'SetEmailThreadFolderStates'
          ? fromPromise(recover(result))
          : fromValue(result)
      )
    );
};
