import { type Span, Telemetry } from '@macro-inc/observability';

/**
 * Run a write to the reader's stacks in its own span, recording whether it
 * succeeded. Record ids and counts on `span`, never a stack's name or the
 * text it matches.
 */
export function traceStackWrite<T>(
  name: string,
  operation: (span: Span) => Promise<T>
): Promise<T> {
  return Telemetry.span(name, async (span) => {
    try {
      const result = await operation(span);
      span.setAttr('stack.outcome', 'succeeded');
      return result;
    } catch (error) {
      span.setAttr('stack.outcome', 'failed');
      // Server messages can quote names; record only which step failed.
      span.error(`${name} failed`);
      throw error;
    }
  });
}
