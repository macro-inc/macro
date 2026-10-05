import type {
  ExecutionResource,
  ExecutionResult,
} from '@service-scheduled-action/generated/schemas';
import { z } from 'zod';
import type { HistoryRecord } from '../core/history';

const resourceSchema = z.object({
  type: z.enum(['chat', 'agent']),
  id: z.string().refine((id) => id.trim().length > 0),
});
const resultSchema = z.object({
  version: z.literal(1),
  resource: resourceSchema.nullish(),
  error: z.string().nullish(),
});

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
  };
}
