import type { Span } from '@macro-inc/observability';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { traceCallMedia } from '../call-media-telemetry';

const span = vi.hoisted(() => ({
  setAttr: vi.fn(),
  error: vi.fn(),
  event: vi.fn(),
  end: vi.fn(),
}));

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: async (
      _name: string,
      operation: (span: Partial<Span>) => Promise<unknown>
    ) => {
      try {
        return await operation(span);
      } finally {
        span.end();
      }
    },
  },
}));

describe('call media telemetry', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    'NotAllowedError',
    'NotFoundError',
    'NotReadableError',
    'OverconstrainedError',
    'SecurityError',
  ])(
    'retains %s without exporting device details or changing the failure',
    async (name) => {
      const error = new DOMException('secret device label and token', name);
      await expect(
        traceCallMedia(
          'enable',
          {
            'call.id': 'call-1',
            'call.media.device': 'microphone',
          },
          async () => {
            throw error;
          }
        )
      ).rejects.toBe(error);
      expect(span.setAttr).toHaveBeenCalledWith('call.id', 'call-1');
      expect(span.setAttr).toHaveBeenCalledWith('error.type', name);
      expect(span.error).toHaveBeenCalledWith(
        `Call media operation failed: ${name}`
      );
      expect(JSON.stringify(span.error.mock.calls)).not.toContain('secret');
      expect(span.end).toHaveBeenCalledOnce();
    }
  );

  it('redacts unknown provider error names as well as messages', async () => {
    const error = new Error('token in message');
    error.name = 'token in name';
    await expect(
      traceCallMedia('publish_prejoin', {}, async () => {
        throw error;
      })
    ).rejects.toBe(error);
    expect(span.error).toHaveBeenCalledExactlyOnceWith(
      'Call media operation failed: UnknownError'
    );
    expect(span.setAttr).toHaveBeenCalledWith('error.type', 'UnknownError');
  });

  it('records a successful operation and preserves its result', async () => {
    const result = { published: true };
    await expect(
      traceCallMedia('publish_prejoin', {}, async () => result)
    ).resolves.toBe(result);
    expect(span.setAttr).toHaveBeenCalledWith(
      'call.media.outcome',
      'succeeded'
    );
    expect(span.error).not.toHaveBeenCalled();
    expect(span.end).toHaveBeenCalledOnce();
  });
});
