import type { Attributes } from '@macro-inc/observability';
import { type LogLevel, logTelemetry } from './telemetry';

export type WalContext = {
  count: number;
  dirty: number;
  mostRecentEdit?: number;
};

export type SyncLogContext = {
  wal?: WalContext;
  misc?: Attributes;
};

/** `document.id` and `session.id` come from the sink's base attrs, not here. */
function contextAttrs(context: SyncLogContext): Attributes {
  const attributes: Attributes = {
    ...context.misc,
    ...(context.wal && {
      'wal.count': context.wal.count,
      'wal.dirty': context.wal.dirty,
      'wal.most_recent_edit': context.wal.mostRecentEdit,
    }),
  };
  return attributes;
}

/**
 * Log a sync-engine message through the document's telemetry sink — the
 * observability library's logging pipeline, which exports the record (when
 * the host initialized an exporter) and always mirrors it to the console.
 *
 * `debug` lines are suppressed unless `window.debugSyncServiceLog` is set,
 * keeping the high-frequency narration out of both the console and the
 * export pipeline by default.
 */
export function logSyncService({
  documentId,
  level,
  context,
  message,
}: {
  documentId: string;
  level: LogLevel;
  context: SyncLogContext;
  message: string;
}): void {
  const debugEnabled =
    typeof window !== 'undefined' &&
    (window as { debugSyncServiceLog?: boolean }).debugSyncServiceLog;
  if (level === 'debug' && !debugEnabled) return;

  logTelemetry(documentId, level, message, contextAttrs(context));
}
