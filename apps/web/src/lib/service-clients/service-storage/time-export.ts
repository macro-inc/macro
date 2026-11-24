import { dssFetch } from './client';
import type { ExportTimeParams } from './generated/schemas/exportTimeParams';
import type { TimeExport } from './generated/schemas/timeExport';

/** A scope's entries over a period, as CSV text inside JSON. */
export function exportTime(params: ExportTimeParams, signal?: AbortSignal) {
  const query = new URLSearchParams({
    scope: params.scope,
    from: params.from,
    to: params.to,
    ...(params.projectId ? { projectId: params.projectId } : {}),
  });
  return dssFetch<TimeExport>(`/time/export?${query}`, { signal });
}
