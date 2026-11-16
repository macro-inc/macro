import {
  makeOperation,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { markSourceAuthority } from './source-authority';

/** Source tokens survive body decoding without depending on the current realm state. */
const generations = new WeakMap<object, string>();
const checks = new WeakMap<object, () => Promise<void>>();
const writeSessions = new WeakMap<Response, () => void>();
export function rememberWriteResponse(
  response: Response,
  assertSession: () => void
) {
  writeSessions.set(response, assertSession);
}

/** The write outcome belongs to its caller; rejected content cannot seed any cache. */
export function preserveMutationOutcome(
  result: OperationResult
): OperationResult | undefined {
  if (result.operation.kind !== 'mutation') return;
  const response = operationResponse(result.operation);
  const assertSession = response && writeSessions.get(response);
  if (!assertSession) return;
  try {
    assertSession();
  } catch {
    return;
  }
  // An explicit rejected token cannot fall back to the operation's usable token.
  markSourceAuthority(
    result.data,
    '00000000-0000-0000-0000-000000000000',
    result.operation.context.cacheAuthorizationEpoch as number | undefined
  );
  return result;
}
export function rememberResponseAuthority(
  response: Response,
  generation: string | undefined,
  check: () => Promise<void>
) {
  if (generation) generations.set(response, generation);
  else generations.delete(response);
  checks.set(response, check);
}
export const responseAuthorityGeneration = (
  response: unknown
): string | undefined =>
  response && typeof response === 'object'
    ? generations.get(response)
    : undefined;
export const hasResponseAuthority = (response: unknown): boolean =>
  !!response && typeof response === 'object' && checks.has(response);
export async function assertResponseAuthority(
  response: unknown
): Promise<void> {
  if (response && typeof response === 'object') await checks.get(response)?.();
}

// urql intentionally omits successful Response objects from OperationResult.
// Keep one transport witness on this dispatch, independent of later same-key reads.
export function captureOperationResponse(op: Operation): Operation {
  if (op.kind !== 'query' && op.kind !== 'mutation') return op;
  const witness: { response?: Response } = {};
  const send = op.context.fetch ?? globalThis.fetch;
  return makeOperation(op.kind, op, {
    ...op.context,
    cacheAuthorityResponse: witness,
    fetch: async (input, init) => {
      const response = await send(input, init);
      witness.response = response;
      return response;
    },
  });
}
export function operationResponse(op: Operation): Response | undefined {
  const witness = op.context.cacheAuthorityResponse as
    | { response?: Response }
    | undefined;
  return witness?.response;
}

// The symbol survives RequestInit spreads but is never sent as a network header.
const settlement = Symbol('cache mutation identity settlement');
export const queuedSettlementRequest = (init: RequestInit): RequestInit =>
  ({ ...init, [settlement]: true }) as RequestInit;
export const isQueuedSettlementRequest = (init?: RequestInit): boolean =>
  !!(init as (RequestInit & { [settlement]?: boolean }) | undefined)?.[
    settlement
  ];
