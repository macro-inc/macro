import { useAgentCodeExecutionQuery } from '@queries/agent-session/code-execution';
import { type Accessor, createMemo } from 'solid-js';
import type { ToolUsePart } from '../component/parts/shared';
import {
  codeExecutionInput,
  codeExecutionReceipt,
  programEnded,
  programFailures,
  programSteps,
} from '../state/code-execution';
import { isToolActive } from '../ui/types';

/**
 * A program call's saved record, and the steps it shows. Its tool group reads
 * the same record to count them and name them on its live line, and the cache
 * shares the one request.
 */
export function useCodeExecutionRecord(
  part: Accessor<ToolUsePart>,
  sessionId: Accessor<string>,
  inFlight: Accessor<boolean>
) {
  const receipt = createMemo(() => codeExecutionReceipt(part()));
  const requestedExecutionId = () => codeExecutionInput(part())?.executionId;
  const executionId = () => {
    const saved = receipt()?.executionId;
    if (saved) return saved;
    return part().status === 'pending' ? undefined : requestedExecutionId();
  };
  const query = useAgentCodeExecutionQuery(sessionId, executionId);
  const source = () => codeExecutionInput(part())?.source;
  // A rejected duplicate ID must not display the previous program's results.
  const record = () =>
    query.isSuccess && query.data.source === source() ? query.data : undefined;
  const error = () => {
    const detail = part().detail;
    return (
      record()?.error ??
      receipt()?.error ??
      ('error' in detail ? detail.error : undefined)
    );
  };
  const ended = () =>
    programEnded({
      error: error(),
      recordRunning: record()?.status === 'running',
      active: inFlight() && isToolActive(part().status),
    });
  const steps = () =>
    programSteps({
      operations: record()?.activity?.length ?? 0,
      calls: record()?.calls.length ?? 0,
      ended: ended(),
    });
  const failures = () => {
    const saved = record();
    return programFailures({
      statuses: [
        ...(saved?.activity ?? []).map((operation) => operation.status),
        ...(saved?.calls ?? []).map((call) => call.status),
      ],
      ended: ended(),
      cancelled: (saved?.status ?? receipt()?.status) === 'cancelled',
    });
  };

  return {
    receipt,
    requestedExecutionId,
    executionId,
    query,
    source,
    record,
    error,
    ended,
    steps,
    failures,
  };
}
