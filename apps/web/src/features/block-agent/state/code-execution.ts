import type { MessagePart } from '@service-agent-fold/generated/types';
import type { ExecutionActivity } from '@service-agent-harness/generated/schemas';
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

/** One row of a program's operations: a step, or the same step repeated. */
export interface ActivityRun<Step> {
  item: Step;
  count: number;
}

/**
 * A program's operations as rows: back-to-back operations with the same label
 * and outcome fold into one, so a loop over one call reads as one step with
 * its count rather than a wall of identical rows. Every view that lists or
 * counts the operations folds them this way, so their counts agree.
 */
export function activityRuns<Step extends { label: string; status: string }>(
  activity: readonly Step[]
): ActivityRun<Step>[] {
  const runs: ActivityRun<Step>[] = [];
  for (const item of activity) {
    const last = runs.at(-1);
    if (last?.item.label === item.label && last.item.status === item.status) {
      last.count += 1;
    } else {
      runs.push({ item, count: 1 });
    }
  }
  return runs;
}

/**
 * The steps a program shows: its rows of observed operations and its
 * historical calls, or one failed row when it ended without any.
 */
export function programSteps(options: {
  activity: readonly ExecutionActivity[];
  calls: number;
  ended: boolean;
}): number {
  const steps = activityRuns(options.activity).length + options.calls;
  return steps === 0 && options.ended ? 1 : steps;
}

/**
 * The failed steps among those a program shows: failed operations and
 * calls, or its one row when it ended without any, unless it was stopped.
 */
export function programFailures(options: {
  statuses: readonly string[];
  ended: boolean;
  cancelled: boolean;
}): number {
  if (options.statuses.length === 0) {
    return options.ended && !options.cancelled ? 1 : 0;
  }
  return options.statuses.filter((status) => status === 'failed').length;
}
