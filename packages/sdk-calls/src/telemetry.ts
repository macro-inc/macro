import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('@macro-inc/sdk-calls');

export function recordError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : String(error));
  span.setStatus({ code: SpanStatusCode.ERROR });
}

export function withSpan<T>(
  name: string,
  action: (span: Span) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await action(span);
    } catch (error) {
      span.setAttribute('call.sdk.outcome', 'failed');
      recordError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function reportError(
  name: string,
  error: unknown,
  callId?: string
): void {
  const span = startSpan(name);
  if (callId) span.setAttribute('call.id', callId);
  recordError(span, error);
  span.end();
}

export function startSpan(name: string): Span {
  return tracer.startSpan(name);
}
