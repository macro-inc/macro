import type { TraceContext } from '@macro-inc/observability';
import { type Exchange, makeOperation, type Operation } from '@urql/core';
import { map, pipe } from 'wonka';

/** Operation context key for the trace a query's request should join. */
export const TRACE_PARENT_CONTEXT_KEY = 'macroTraceParent';

function traced(operation: Operation): Operation {
  const parent: TraceContext | undefined =
    operation.context[TRACE_PARENT_CONTEXT_KEY];
  if (!parent || operation.kind === 'teardown') return operation;
  const send = operation.context.fetch ?? fetch;
  return makeOperation(operation.kind, operation, {
    ...operation.context,
    // fetchExchange calls this synchronously when it sends, so the transport's
    // client span starts in the parent's trace and injects its traceparent.
    fetch: (input, init) => parent.run(() => send(input, init)),
  });
}

/**
 * Starts each request in the trace its query asked for. Place it directly
 * before `fetchExchange`: cache hits never reach it, and requests the cache
 * exchanges issue on their own keep their caller's context.
 */
export const traceParentExchange: Exchange =
  ({ forward }) =>
  (operations$) =>
    forward(pipe(operations$, map(traced)));
