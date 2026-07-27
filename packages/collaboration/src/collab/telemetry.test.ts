import { type Span, Telemetry } from '@macro-inc/observability';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { disposeTelemetryFor, telemetrySpan } from './telemetry';

const documentId = 'telemetry-test-document';

function mockSpan() {
  const error = vi.fn();
  const span: Span = {
    span: (() => span) as Span['span'],
    run: (operation) => operation(),
    setAttr: vi.fn(),
    event: vi.fn(),
    error,
    traceparent: () => undefined,
    injectTraceHeaders: vi.fn(),
    end: vi.fn(),
  };
  vi.spyOn(Telemetry, 'span').mockImplementation(((
    _: string,
    operation?: (span: Span) => Promise<unknown>
  ) => (operation ? operation(span) : span)) as typeof Telemetry.span);
  return { span, error };
}

afterEach(() => {
  disposeTelemetryFor(documentId);
  vi.restoreAllMocks();
});

describe('telemetrySpan', () => {
  test('enriches and delegates the async operation', async () => {
    const { span, error } = mockSpan();

    const result = await telemetrySpan(
      documentId,
      'test',
      async (activeSpan) => {
        expect(activeSpan).toBe(span);
        return 42;
      }
    );

    expect(result).toBe(42);
    expect(error).not.toHaveBeenCalled();
    expect(span.setAttr).toHaveBeenCalledWith('document.id', documentId);
    expect(span.setAttr).toHaveBeenCalledWith('session.id', expect.any(String));
  });
});
