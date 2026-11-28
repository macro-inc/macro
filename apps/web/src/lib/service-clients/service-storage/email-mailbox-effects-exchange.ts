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
import {
  CombinedError,
  type Exchange,
  makeOperation,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { filter, fromPromise, fromValue, map, mergeMap, pipe } from 'wonka';
import {
  RecoverEmailThreadFolderRowDocument,
  type SetEmailThreadFolderStatesMutation,
} from './graphql/generated/graphql';

const FOLDER_RECOVERY_TIMEOUT_MS = 2_500;

function mailboxOperationKind(operation: Operation) {
  if (operation.kind === 'query' && operation.context.emailMailboxRecovery)
    return 'query';
  if (
    operation.kind === 'mutation' &&
    documentOperationName(operation.query) === 'SetEmailThreadFolderStates'
  )
    return 'mutation';
}

type MailboxTransport = { response?: Response };

/** urql drops the HTTP response from error-free GraphQL payloads. */
function trackMailboxResponse(operation: Operation): Operation {
  if (!mailboxOperationKind(operation) || queueAttemptOf(operation))
    return operation;
  const transport: MailboxTransport = {};
  const fetch = operation.context.fetch ?? globalThis.fetch;
  return makeOperation(operation.kind, operation, {
    ...operation.context,
    emailMailboxTransport: transport,
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      transport.response = response;
      return response;
    },
  });
}

function mailboxServerFailure(result: OperationResult) {
  const attempt = queueAttemptOf(result.operation);
  const transport: MailboxTransport | undefined =
    result.operation.context.emailMailboxTransport;
  const response =
    result.error?.response ?? attempt?.response ?? transport?.response;
  if (!response || response.status < 500) return;
  return (
    result.error ??
    new CombinedError({
      networkError: new Error(`HTTP ${response.status}`),
      response,
    })
  );
}

/** Recover acknowledged Mail rows within a fixed budget. A durable write can
 * settle without its row and retry only that read after local settlement. */
export function createEmailMailboxEffectsExchange(
  host?: Pick<CacheHost, 'onMutationSettled'>,
  revalidateAfterMissedUpdate?: () => void
): Exchange {
  return ({ client, forward }) => {
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
                            emailMailboxRecovery: true,
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
      const attempt = queueAttemptOf(result.operation);
      if (host && attempt && unrepaired.length && isCurrent()) {
        const stop = host.onMutationSettled((settlement) => {
          if (settlement.transactionId !== attempt.transactionId) return;
          clearTimeout(expire);
          stop();
          if (settlement.status !== 'committed' || !isCurrent()) return;
          fireAndForget(
            (async () => {
              await repair(unrepaired);
              if (
                isCurrent() &&
                unrepaired.some((index) => !recovered[index].effect)
              )
                revalidateAfterMissedUpdate?.();
            })(),
            'email.folder.row_recovery'
          );
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
        forward(pipe(operations$, map(trackMailboxResponse))),
        mergeMap((result) => {
          const kind = mailboxOperationKind(result.operation);
          if (!kind) return fromValue(result);
          const error = mailboxServerFailure(result);
          if (error) return fromValue({ ...result, data: undefined, error });
          return kind === 'mutation'
            ? fromPromise(recover(result))
            : fromValue(result);
        })
      );
  };
}

export const emailMailboxEffectsExchange = createEmailMailboxEffectsExchange();
