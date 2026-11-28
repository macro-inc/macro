import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { firstOrAborted } from '@core/util/abort-signal';
import { fireAndForget } from '@core/util/fireAndForget';
import { documentOperationName } from '@graphql-cache/exchange/generated-selection';
import {
  QUEUE_LEASE_MS,
  queueAttemptOf,
} from '@graphql-cache/exchange/mutation-queue-runner';
import type { CacheHost } from '@graphql-cache/host/types';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry } from '@macro-inc/observability';
import type { Exchange, OperationResult } from '@urql/core';
import { filter, fromPromise, fromValue, mergeMap, pipe } from 'wonka';
import {
  RecoverEmailThreadFolderRowDocument,
  type SetEmailThreadFolderStatesMutation,
} from './graphql/generated/graphql';

const FOLDER_RECOVERY_TIMEOUT_MS = 2_500;

/** Recover acknowledged Mail rows within a fixed budget. A durable write can
 * settle without its row and retry only that read after local settlement. */
export function createEmailMailboxEffectsExchange(
  host?: Pick<CacheHost, 'onMutationSettled'>
): Exchange {
  return ({ client, forward }) => {
    async function recover(
      result: OperationResult<SetEmailThreadFolderStatesMutation>
    ) {
      const rows = result.data?.setEmailThreadFolderStates;
      const attempt = queueAttemptOf(result.operation);
      const response = result.error?.response ?? attempt?.response;
      if (!rows || result.error?.networkError || (response?.status ?? 0) >= 500)
        return result;

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
      const isCurrent = () =>
        typeof generation !== 'string' ||
        cacheSessionGeneration.isCurrent(generation);
      const recovered = rows.map((row, index) =>
        missing.has(index) ? { ...row, effect: null } : row
      );
      const repair = (indices: readonly number[]) => {
        const signal = AbortSignal.timeout(FOLDER_RECOVERY_TIMEOUT_MS);
        const work = () =>
          Telemetry.span('email.folder.row_recovery', async (span) => {
            span.setAttr('email.thread.count', indices.length);
            for (let start = 0; start < indices.length; start += 4) {
              if (signal.aborted || !isCurrent()) break;
              await Promise.all(
                indices.slice(start, start + 4).map(async (index) => {
                  const row = rows[index];
                  try {
                    const response = await firstOrAborted(
                      pipe(
                        client.query(
                          RecoverEmailThreadFolderRowDocument,
                          { threadId: row.threadId },
                          {
                            requestPolicy: 'network-only',
                            [TRACE_PARENT_CONTEXT_KEY]: span,
                          }
                        ),
                        filter((value) => !value.stale && !value.hasNext)
                      ),
                      signal
                    );
                    const value =
                      response.kind === 'value' ? response.value : null;
                    const effect = value?.data?.user?.soupEntity;
                    if (
                      !value?.error &&
                      effect?.__typename === 'GraphqlSoupEmailThread' &&
                      effect.id === row.threadId &&
                      isCurrent()
                    )
                      recovered[index] = { ...row, effect };
                    else if (!value || value.error)
                      span.error('Mailbox row recovery failed');
                  } catch {
                    span.error('Mailbox row recovery failed');
                  }
                })
              );
            }
          });
        return trace ? trace.run(work) : work();
      };
      // Only errors under acknowledged effects are swallowed. A failed repair
      // still leaves the server acknowledgement available for bulk compensation.
      const indices = [...missing];
      await repair(indices);
      const unrepaired = indices.filter((index) => !recovered[index].effect);
      if (host && attempt && unrepaired.length && isCurrent()) {
        const stop = host.onMutationSettled((settlement) => {
          if (settlement.transactionId !== attempt.transactionId) return;
          clearTimeout(expire);
          stop();
          if (settlement.status === 'committed' && isCurrent())
            fireAndForget(repair(unrepaired), 'email.folder.row_recovery');
        });
        const expire = setTimeout(stop, QUEUE_LEASE_MS);
      }
      return {
        ...result,
        error: undefined,
        data: { setEmailThreadFolderStates: [...recovered] },
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
}

export const emailMailboxEffectsExchange = createEmailMailboxEffectsExchange();
