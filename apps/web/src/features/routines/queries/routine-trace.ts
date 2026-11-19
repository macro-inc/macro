import type { Span } from '@macro-inc/observability';

export async function traceRoutineRequest<T>(
  span: Span,
  request: () => Promise<T>
) {
  try {
    return await span.run(request);
  } catch (error) {
    span.error('Routine request failed');
    throw error;
  } finally {
    span.end();
  }
}
