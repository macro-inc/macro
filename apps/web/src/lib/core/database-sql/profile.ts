import type { Span } from '@macro-inc/observability';

/** Synchronous work, including Solid's downstream reactive updates. */
export function profileDatabasePhase<T>(span: Span, operation: () => T): T {
  try {
    return span.run(operation);
  } finally {
    span.end();
  }
}

/** Two animation frames provide a rendering opportunity, not proof of paint. */
export function traceDatabaseFrame(span: Span): () => void {
  let ended = false;
  let frame: number | undefined;
  const finish = (status: 'ready' | 'cancelled' | 'hidden' | 'timeout') => {
    if (ended) return;
    ended = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    clearTimeout(timeout);
    document.removeEventListener('visibilitychange', visibilityChanged);
    span.setAttr('database_sql.frame_status', status);
    span.end();
  };
  const visibilityChanged = () => {
    if (document.hidden) finish('hidden');
  };
  const timeout = setTimeout(() => finish('timeout'), 10_000);
  document.addEventListener('visibilitychange', visibilityChanged);
  if (document.hidden) finish('hidden');
  else
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => finish('ready'));
    });
  return () => finish('cancelled');
}
