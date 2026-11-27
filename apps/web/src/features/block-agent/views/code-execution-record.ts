import { useAgentCodeExecutionQuery } from '@queries/agent-session/code-execution';
import { type Accessor, createMemo } from 'solid-js';
import type { ToolUsePart } from '../component/parts/shared';
import {
  codeExecutionInput,
  codeExecutionReceipt,
} from '../state/code-execution';

/**
 * A program call's saved record, and the steps it shows. Its tool group reads
 * the same record to count them and name them on its live line, and the cache
 * shares the one request.
 */
export function useCodeExecutionRecord(
  part: Accessor<ToolUsePart>,
  sessionId: Accessor<string>
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
  // A program that ended without a step shows nothing, so counts nothing.
  const steps = () =>
    (record()?.activity?.length ?? 0) + (record()?.calls.length ?? 0);

  return {
    receipt,
    requestedExecutionId,
    executionId,
    query,
    source,
    record,
    steps,
  };
}
