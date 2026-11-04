import {
  type Attributes,
  type Span,
  Telemetry,
} from '@macro-inc/observability';

/** Provider messages can contain device labels, URLs, or credentials. */
export function callMediaErrorType(error: unknown): string {
  const name =
    error instanceof Error || error instanceof DOMException
      ? error.name
      : undefined;
  const known = [
    'NotAllowedError',
    'SecurityError',
    'NotFoundError',
    'DevicesNotFoundError',
    'NotReadableError',
    'TrackStartError',
    'AbortError',
    'OverconstrainedError',
    'ConstraintNotSatisfiedError',
    'NotSupportedError',
    'TypeError',
  ];
  return name && known.includes(name) ? name : 'UnknownError';
}

export function recordCallMediaFailure(span: Span, error: unknown) {
  const type = callMediaErrorType(error);
  span.setAttr('error.type', type);
  span.setAttr('call.media.outcome', 'failed');
  span.error(`Call media operation failed: ${type}`);
  span.event('call.media.failed', { 'error.type': type });
}

/** Keep background publication and later device actions on the active trace. */
export async function traceCallMedia<T>(
  phase: string,
  attributes: Attributes,
  operation: (span: Span) => Promise<T>,
  parent?: Span
): Promise<T> {
  const run = async (span: Span) => {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) span.setAttr(key, value);
    }
    try {
      const result = await operation(span);
      span.setAttr('call.media.outcome', 'succeeded');
      return result;
    } catch (error) {
      recordCallMediaFailure(span, error);
      throw error;
    }
  };
  return parent
    ? parent.span(`call.media.${phase}`, run)
    : Telemetry.span(`call.media.${phase}`, run);
}
