import { Telemetry, type TraceContext } from '@macro-inc/observability';
import { type Exchange, makeOperation, type Operation } from '@urql/core';
import { map, pipe } from 'wonka';

/** Operation context key for the trace a query's request should join. */
export const TRACE_PARENT_CONTEXT_KEY = 'macroTraceParent';

/**
 * The caller's context for the operation's first request only: a re-sent
 * operation (cache revalidation, refetch) must not join a trace that ended.
 * Running anything in it uses it up, so an exchange that does must store a
 * fresh one for the request.
 */
export function firstRequestIn(parent: TraceContext): TraceContext {
  let used = false;
  return {
    run(work) {
      if (used) return work();
      used = true;
      return parent.run(work);
    },
  };
}

// Mutations are sent by the mutation queue inside its own attempt span.
function captured(operation: Operation): Operation {
  if (operation.kind !== 'query' || operation.context[TRACE_PARENT_CONTEXT_KEY])
    return operation;
  return makeOperation(operation.kind, operation, {
    ...operation.context,
    [TRACE_PARENT_CONTEXT_KEY]: firstRequestIn(Telemetry.captureContext()),
  });
}

function traced(operation: Operation): Operation {
  const parent: TraceContext | undefined =
    operation.context[TRACE_PARENT_CONTEXT_KEY];
  if (!parent || operation.kind !== 'query') return operation;
  const send = operation.context.fetch ?? fetch;
  return makeOperation(operation.kind, operation, {
    ...operation.context,
    // fetchExchange calls this synchronously when it sends, so the transport's
    // client span starts in the parent's trace and injects its traceparent.
    fetch: (input, init) => parent.run(() => send(input, init)),
  });
}

/**
 * First in the chain: remembers the span context an operation was started in
 * (client.query inside a span or a TanStack query function), unless a query
 * binding already named its flow.
 */
export const captureTraceParentExchange: Exchange =
  ({ forward }) =>
  (operations$) =>
    forward(pipe(operations$, map(captured)));

/**
 * Directly before `fetchExchange`: sends each request in the trace its
 * operation carries. Cache hits never reach it.
 */
export const traceParentExchange: Exchange =
  ({ forward }) =>
  (operations$) =>
    forward(pipe(operations$, map(traced)));
