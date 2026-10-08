import { useAgentCodeExecutionQuery } from '@queries/agent-session/code-execution';
import { ExecutionReceipt } from '@service-cognition/generated/tools/schemas';
import { createMemo, Suspense } from 'solid-js';
import { validate as isUuid } from 'uuid';
import { CodeExecutionToolCall } from '../component/parts/CodeExecutionToolCall';
import type {
  ToolCallCommon,
  ToolCallContext,
  ToolUsePart,
} from '../component/parts/shared';

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
    return parsed.success && isUuid(parsed.data.executionId)
      ? parsed.data
      : undefined;
  });
  const input = () =>
    'input' in props.part.detail ? props.part.detail.input : undefined;
  const executionId = () => {
    const saved = receipt()?.executionId;
    if (saved) return saved;
    if (props.common.status !== 'completed' && props.common.status !== 'failed')
      return undefined;
    const value = input();
    return typeof value === 'object' &&
      value !== null &&
      'execution_id' in value &&
      typeof value.execution_id === 'string' &&
      isUuid(value.execution_id)
      ? value.execution_id
      : undefined;
  };
  const query = useAgentCodeExecutionQuery(
    () => props.context.sessionId,
    executionId
  );
  const source = () => {
    const detail = props.part.detail;
    const input = 'input' in detail ? detail.input : undefined;
    return typeof input === 'object' &&
      input !== null &&
      'source' in input &&
      typeof input.source === 'string'
      ? input.source
      : undefined;
  };
  // A rejected duplicate ID must not display the previous program's results.
  const record = () =>
    query.isSuccess && query.data.source === source() ? query.data : undefined;
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
        <p class="text-xs text-ink-extra-muted">Loading code results…</p>
      }
    >
      <CodeExecutionToolCall
        common={common()}
        context={props.context}
        record={record()}
        source={source()}
        error={
          record()?.error ??
          receipt()?.error ??
          ('error' in props.part.detail ? props.part.detail.error : undefined)
        }
        loading={Boolean(executionId()) && query.isPending}
        unavailable={query.isError}
      />
    </Suspense>
  );
}
