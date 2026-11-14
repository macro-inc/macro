import { makeOperation, type Operation } from '@urql/core';

/** Source tokens survive body decoding without depending on the current realm state. */
const generations = new WeakMap<object, string>();
const checks = new WeakMap<object, () => Promise<void>>();
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
