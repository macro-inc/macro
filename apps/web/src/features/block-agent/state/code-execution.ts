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
 * The view a code run returned for the user. Code mode fails a run whose view
 * the renderer would not draw, so only a run that succeeded shows one.
 */
export function returnedView(
  status: string | undefined,
  result: unknown
): object | undefined {
  if (
    status !== 'succeeded' ||
    !result ||
    typeof result !== 'object' ||
    !('view' in result)
  )
    return;
  const view = result.view;
  return view && typeof view === 'object' ? view : undefined;
}
