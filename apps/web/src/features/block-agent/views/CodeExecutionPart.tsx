import { createEffect, on, Suspense } from 'solid-js';
import { CodeExecutionToolCall } from '../component/parts/CodeExecutionToolCall';
import type {
  ToolCallCommon,
  ToolCallContext,
  ToolUsePart,
} from '../component/parts/shared';
import { useCodeExecutionRecord } from './code-execution-record';

/** Production wiring; the result components receive only data and context. */
export function CodeExecutionPart(props: {
  part: ToolUsePart;
  common: ToolCallCommon;
  context: ToolCallContext;
}) {
  const {
    receipt,
    requestedExecutionId,
    executionId,
    query,
    source,
    record,
    error,
  } = useCodeExecutionRecord(
    () => props.part,
    () => props.context.sessionId,
    () => props.context.inFlight
  );

  if (import.meta.env.DEV) {
    let loggedCall: string | undefined;
    // Log complete dispatched input, not the model's pending argument chunks.
    createEffect(
      on(
        [
          () => props.part.status,
          () => props.context.sessionId,
          () => props.common.id,
          requestedExecutionId,
          source,
        ],
        ([status, sessionId, toolCallId, executionId, source]) => {
          if (status === 'pending' || !executionId || source === undefined)
            return;
          const call = `${sessionId}:${toolCallId}`;
          if (loggedCall === call) return;
          loggedCall = call;
          console.log(
            '[Code mode] ExecuteCode',
            { sessionId, executionId, toolCallId },
            `\n${source}`
          );
        }
      )
    );
  }

  const status = () => record()?.status ?? receipt()?.status;
  const common = (): ToolCallCommon => {
    const outcome = status();
    if (!outcome || outcome === 'succeeded' || outcome === 'running')
      return props.common;
    return {
      ...props.common,
      status: 'failed',
      muted: true,
      trailing:
        outcome === 'cancelled'
          ? 'Cancelled'
          : outcome === 'timed_out'
            ? 'Timed out'
            : 'Failed',
    };
  };

  return (
    <Suspense
      fallback={
        <p class="text-xs text-ink-extra-muted">Loading workspace activity…</p>
      }
    >
      <CodeExecutionToolCall
        common={common()}
        context={props.context}
        record={record()}
        error={error()}
        loading={Boolean(executionId()) && query.isPending}
        unavailable={
          query.isError || (query.isSuccess && query.data.source !== source())
        }
      />
    </Suspense>
  );
}
