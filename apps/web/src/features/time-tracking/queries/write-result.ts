import { optimisticMutationDispositionOf } from '@graphql-cache/index';
import type { AnyVariables, CombinedError, OperationResult } from '@urql/core';
import { err, ok, type Result } from 'neverthrow';

/** The timer the server refused to stop because it ran past the limit. */
export type OverLimitTimer = { id: string; taskId: string; startedAt: string };

/** Why a time write did not land. */
export type TimeWriteError =
  /** The timer ran past the limit; say when it stopped, log all of it, or discard it. */
  | { kind: 'over-limit'; timer: OverLimitTimer }
  /** The server refused the write; `code` is its machine-readable reason. */
  | { kind: 'refused'; code: string | undefined; message: string }
  /** The request did not complete. */
  | { kind: 'failed'; error: Error };

/** A write the server committed, with its reply, or one the offline queue holds. */
export type TimeWriteOutcome<TData = undefined> =
  | { kind: 'committed'; data: TData | undefined }
  | { kind: 'queued' };

export type TimeWriteResult<TData = undefined> = Result<
  TimeWriteOutcome<TData>,
  TimeWriteError
>;

function overLimitTimer(value: unknown): OverLimitTimer | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { id, taskId, startedAt } = value as Record<string, unknown>;
  return typeof id === 'string' &&
    typeof taskId === 'string' &&
    typeof startedAt === 'string'
    ? { id, taskId, startedAt }
    : undefined;
}

/** Read the server's refusal from a GraphQL error, or report a failed request. */
export function timeWriteError(error: CombinedError): TimeWriteError {
  const [first] = error.graphQLErrors;
  if (!first) return { kind: 'failed', error };
  const code = first.extensions?.code;
  const timer =
    code === 'TIMER_OVER_LIMIT'
      ? overLimitTimer(first.extensions?.timer)
      : undefined;
  if (timer) return { kind: 'over-limit', timer };
  return {
    kind: 'refused',
    code: typeof code === 'string' ? code : undefined,
    message: first.message,
  };
}

/** Settle a durable optimistic write: committed, queued offline, or refused. */
export function timeWriteResult<TData, TVariables extends AnyVariables>(
  result: OperationResult<TData, TVariables>
): TimeWriteResult {
  const disposition = optimisticMutationDispositionOf(result);
  if (disposition?.kind === 'queued') return ok({ kind: 'queued' });
  if (disposition?.kind === 'permanently-failed') {
    return err(timeWriteError(disposition.error));
  }
  if (result.error) return err(timeWriteError(result.error));
  return ok({ kind: 'committed', data: undefined });
}

/** Settle an authoritative write, whose reply the caller reads. */
export function authoritativeWriteResult<
  TData,
  TVariables extends AnyVariables,
  TOut,
>(
  result: OperationResult<TData, TVariables>,
  select: (data: TData) => TOut
): TimeWriteResult<TOut> {
  if (result.error) return err(timeWriteError(result.error));
  if (!result.data) {
    return err({
      kind: 'failed',
      error: new Error('time tracking mutation returned no data'),
    });
  }
  return ok({ kind: 'committed', data: select(result.data) });
}
