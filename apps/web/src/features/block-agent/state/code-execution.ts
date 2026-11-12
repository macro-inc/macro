import type { MessagePart } from '@service-agent-fold/generated/types';
import { ExecutionReceipt } from '@service-cognition/generated/tools/schemas';

// Match UUIDs accepted by Rust, including reserved versions and variants.
export const isExecutionId = (value: string) =>
  /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);

/** The program and, when the agent chose one, the requested execution ID. */
export function codeExecutionInput(part: MessagePart) {
  const input =
    part.kind === 'tool_use' && 'input' in part.detail
      ? part.detail.input
      : undefined;
  if (
    !input ||
    typeof input !== 'object' ||
    !('source' in input) ||
    typeof input.source !== 'string'
  )
    return;
  const requested =
    'execution_id' in input &&
    typeof input.execution_id === 'string' &&
    isExecutionId(input.execution_id)
      ? input.execution_id
      : undefined;
  return { executionId: requested, source: input.source };
}

/** The tool's receipt, once the server has replied. */
export function codeExecutionReceipt(part: MessagePart) {
  const detail = part.kind === 'tool_use' ? part.detail : undefined;
  const raw =
    detail?.kind === 'other'
      ? (detail.result ?? detail.output)
      : detail?.kind === 'macro'
        ? detail.output
        : undefined;
  const parsed = ExecutionReceipt.safeParse(raw);
  return parsed.success && isExecutionId(parsed.data.executionId)
    ? parsed.data
    : undefined;
}

/**
 * The saved execution's ID: the receipt's, since the server assigns one when
 * the agent omits it or its ID was taken; else the one the agent requested.
 */
export function codeExecutionId(part: MessagePart) {
  return (
    codeExecutionReceipt(part)?.executionId ??
    codeExecutionInput(part)?.executionId
  );
}
