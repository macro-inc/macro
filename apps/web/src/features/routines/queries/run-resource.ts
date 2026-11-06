import type {
  ExecutionResource,
  ExecutionResult,
} from '@service-scheduled-action/generated/schemas';
import { z } from 'zod';
import type {
  HistoryRecord,
  HistoryRun,
  HistorySkip,
  HistoryStep,
} from '../core/history';

const resourceSchema = z.object({
  type: z.enum(['chat', 'agent']),
  id: z.string().refine((id) => id.trim().length > 0),
});
const resultSchema = z.object({
  version: z.literal(1),
  resource: resourceSchema.nullish(),
  error: z.string().nullish(),
});

const conditionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not_met'), probability: z.number() }),
  z.object({ status: z.literal('unavailable') }),
]);

const stepSchema = z.discriminatedUnion('kind', [
  z.object({
    path: z.string(),
    kind: z.literal('agent'),
    error: z.string().optional(),
  }),
  z
    .object({
      path: z.string(),
      kind: z.literal('code'),
      calls: z
        .array(
          z.object({
            operation: z.string(),
            label: z.string(),
            write: z.boolean().optional(),
            status: z.enum([
              'completed',
              'failed',
              'skipped',
              'refused',
              'unknown',
            ]),
            started_ms: z.number(),
            duration_ms: z.number().optional(),
          })
        )
        .optional(),
      calls_truncated: z.boolean().optional(),
      output: z.unknown().optional(),
      error: z.string().optional(),
    })
    .transform((step) => ({
      path: step.path,
      kind: step.kind,
      calls: (step.calls ?? []).map((call) => ({
        operation: call.operation,
        label: call.label,
        write: call.write ?? false,
        status: call.status,
        startedMs: call.started_ms,
        durationMs: call.duration_ms,
      })),
      callsTruncated: step.calls_truncated ?? false,
      output: step.output,
      error: step.error,
    })),
]);
const runSchema = z
  .object({
    run: z.object({
      at: z.string(),
      timezone: z.string().optional(),
      previous_at: z.string().optional(),
      // An unknown identity hides the line rather than the whole run info.
      code_acts_as: z.enum(['agent', 'owner']).optional().catch(undefined),
      started_by: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('schedule'),
          schedule: z.string(),
          timezone: z.string(),
        }),
        z.object({
          kind: z.literal('event'),
          event: z.string(),
          entity_id: z.string().nullish(),
        }),
        z.object({ kind: z.literal('manual'), by: z.string() }),
      ]),
    }),
  })
  .transform(
    ({ run }): HistoryRun => ({
      at: run.at,
      timezone: run.timezone,
      previousAt: run.previous_at,
      ...(run.code_acts_as ? { codeActsAs: run.code_acts_as } : {}),
      start:
        run.started_by.kind === 'event'
          ? {
              kind: 'event',
              event: run.started_by.event,
              entityId: run.started_by.entity_id ?? undefined,
            }
          : run.started_by,
    })
  );
const stepsSchema = z.object({ steps: z.array(stepSchema) });
const errorSchema = z.object({ error: z.string() });
const revisionSchema = z.object({ configuration_revision: z.number().int() });

/** What each step of a run did; unknown or older results have none. */
function getHistorySteps(record: {
  result: unknown;
}): HistoryStep[] | undefined {
  const parsed = stepsSchema.safeParse(record.result);
  return parsed.success && parsed.data.steps.length
    ? parsed.data.steps
    : undefined;
}

/** A run its trigger's condition skipped; old and unknown results are runs. */
export function getHistorySkip(record: {
  result: unknown;
}): HistorySkip | undefined {
  const result = record.result;
  if (typeof result !== 'object' || result === null || !('condition' in result))
    return undefined;
  const parsed = conditionSchema.safeParse(result.condition);
  if (!parsed.success) return undefined;
  return parsed.data.status === 'not_met'
    ? { reason: 'not_met', probability: parsed.data.probability }
    : { reason: 'unavailable' };
}

export function decodeExecutionResource(
  value: unknown
): ExecutionResource | undefined {
  const parsed = resourceSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function decodeExecutionResult(
  value: unknown
): ExecutionResult | undefined {
  const parsed = resultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** A present typed field, even if invalid or null, must not become a chat. */
export function getExecutionResource(execution: {
  resource?: unknown;
  chat_id?: unknown;
}): ExecutionResource | undefined {
  if (execution.resource !== undefined) {
    return decodeExecutionResource(execution.resource);
  }
  return decodeExecutionResource({ type: 'chat', id: execution.chat_id });
}

/** Only null/string results predate the versioned envelope. */
export function getHistoryResource(record: {
  result: unknown;
  resource_id?: unknown;
}): ExecutionResource | undefined {
  if (record.result === null || typeof record.result === 'string') {
    return decodeExecutionResource({ type: 'chat', id: record.resource_id });
  }
  return decodeExecutionResult(record.result)?.resource ?? undefined;
}

export function resourcesMatch(
  left: ExecutionResource | undefined,
  right: ExecutionResource
): boolean {
  return left?.type === right.type && left.id === right.id;
}

export function toHistoryRecord(record: {
  id?: string | null;
  result: unknown;
  resource_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  is_success?: boolean | null;
}): HistoryRecord {
  return {
    id: record.id,
    resource: getHistoryResource(record),
    startedAt: record.start_time,
    endedAt: record.end_time,
    success: record.is_success,
    skipped: getHistorySkip(record),
    steps: getHistorySteps(record),
    run: runSchema.safeParse(record.result).data,
    revision: revisionSchema.safeParse(record.result).data
      ?.configuration_revision,
    error: errorSchema.safeParse(record.result).data?.error,
  };
}
