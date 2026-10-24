import { useAgentCodeExecutionQuery } from '@queries/agent-session/code-execution';
import { ExecutionReceipt } from '@service-cognition/generated/tools/schemas';
import { createEffect, createMemo, on, Suspense } from 'solid-js';
import { CodeExecutionToolCall } from '../component/parts/CodeExecutionToolCall';
import type {
  ToolCallCommon,
  ToolCallContext,
  ToolUsePart,
} from '../component/parts/shared';
import {
  codeExecutionInput,
  isExecutionId,
  returnedView,
} from '../state/code-execution';

/** Production wiring; the result components receive only data and context. */
export function CodeExecutionPart(props: {
  part: ToolUsePart;
  common: ToolCallCommon;
  context: ToolCallContext;
}) {
  const receipt = createMemo(() => {
    const detail = props.part.detail;
    const raw =
      detail.kind === 'other'
        ? (detail.result ?? detail.output)
        : detail.kind === 'macro'
          ? detail.output
          : undefined;
    const parsed = ExecutionReceipt.safeParse(raw);
    return parsed.success && isExecutionId(parsed.data.executionId)
      ? parsed.data
      : undefined;
  });
  const requestedExecutionId = () =>
    codeExecutionInput(props.part)?.executionId;
  const executionId = () => {
    const saved = receipt()?.executionId;
    if (saved) return saved;
    return props.part.status === 'pending' ? undefined : requestedExecutionId();
  };
  const query = useAgentCodeExecutionQuery(
    () => props.context.sessionId,
    executionId
  );
  const source = () => codeExecutionInput(props.part)?.source;

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

  // A rejected duplicate ID must not display the previous program's results.
  const record = () =>
    query.isSuccess && query.data.source === source() ? query.data : undefined;
  const status = () => record()?.status ?? receipt()?.status;
  const view = () =>
    returnedView(status(), record() ? record()?.result : receipt()?.result);
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
        view={view()}
        error={
          record()?.error ??
          receipt()?.error ??
          ('error' in props.part.detail ? props.part.detail.error : undefined)
        }
        loading={Boolean(executionId()) && query.isPending}
        unavailable={
          query.isError || (query.isSuccess && query.data.source !== source())
        }
      />
    </Suspense>
  );
}
