import type { ExportTimeParams } from '@service-storage/generated/schemas/exportTimeParams';
import type { TimeExport } from '@service-storage/generated/schemas/timeExport';
import { exportTime } from '@service-storage/time-export';
import { err, ok, type Result } from 'neverthrow';

/** Reads a scope's entries as CSV; read-only, so it is never queued offline. */
export async function readTimeExport(
  params: ExportTimeParams,
  signal?: AbortSignal
): Promise<Result<TimeExport, { kind: 'failed' }>> {
  const result = await exportTime(params, signal);
  return result.isOk() ? ok(result.value) : err({ kind: 'failed' });
}
