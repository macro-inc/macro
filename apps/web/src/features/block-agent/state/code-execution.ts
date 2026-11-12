import type { MessagePart } from '@service-agent-fold/generated/types';

// Match UUIDs accepted by Rust, including reserved versions and variants.
export const isExecutionId = (value: string) =>
  /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);

export function codeExecutionInput(part: MessagePart) {
  const input =
    part.kind === 'tool_use' && 'input' in part.detail
      ? part.detail.input
      : undefined;
  if (
    !input ||
    typeof input !== 'object' ||
    !('execution_id' in input) ||
    typeof input.execution_id !== 'string' ||
    !isExecutionId(input.execution_id) ||
    !('source' in input) ||
    typeof input.source !== 'string'
  )
    return;
  return { executionId: input.execution_id, source: input.source };
}

/**
 * Whether a program ended badly. The error text is written for the agent,
 * which reads it and retries; the person only sees that the step failed.
 */
export function programEnded(options: {
  error: string | null | undefined;
  recordRunning: boolean;
  active: boolean;
}): boolean {
  return Boolean(options.error && (!options.recordRunning || !options.active));
}

/**
 * The steps a program shows: its observed operations and historical calls,
 * or one failed row when it ended without any.
 */
export function programSteps(options: {
  operations: number;
  calls: number;
  ended: boolean;
}): number {
  const steps = options.operations + options.calls;
  return steps === 0 && options.ended ? 1 : steps;
}
