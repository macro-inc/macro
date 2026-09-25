import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  span: {
    setAttr: vi.fn(),
    injectTraceHeaders: vi.fn(),
    run: (callback: () => Promise<Response>) => callback(),
    error: vi.fn(),
    end: vi.fn(),
  },
  clientSpan: vi.fn(),
}));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { calls: 'https://gateway.example' },
  SYNC_SERVICE_HOSTS: { worker: 'https://sync.example' },
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { clientSpan: mocks.clientSpan },
}));
vi.mock('./platformFetch', () => ({ platformFetch: mocks.fetch }));

import { safeFetch } from './safeFetch';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clientSpan.mockReturnValue(mocks.span);
});

describe('safeFetch capability URL privacy', () => {
  it('keeps the request capability intact while redacting telemetry and error spans', async () => {
    const url = 'https://gateway.example/dss/call/join/secret-token/leave';
    mocks.fetch.mockResolvedValue(new Response('', { status: 403 }));
    await safeFetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer scoped-token' },
    });
    expect(mocks.fetch.mock.calls[0][0]).toBe(url);
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer scoped-token'
    );
    expect(mocks.clientSpan).toHaveBeenCalledWith(
      'http POST /dss/call/join/:shareToken/leave'
    );
    const telemetry = JSON.stringify([
      mocks.clientSpan.mock.calls,
      mocks.span.setAttr.mock.calls,
      mocks.span.error.mock.calls,
    ]);
    expect(telemetry).not.toContain('secret-token');
    expect(telemetry).not.toContain('scoped-token');
  });

  it('sanitizes provider exceptions that echo the requested URL', async () => {
    mocks.fetch.mockRejectedValue(
      new Error(
        'Failed: https://gateway.example/call/meetings/join/secret-token'
      )
    );
    const result = await safeFetch(
      'https://gateway.example/call/meetings/join/secret-token'
    );
    expect(JSON.stringify(mocks.span.error.mock.calls)).not.toContain(
      'secret-token'
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(JSON.stringify(result.error)).not.toContain('secret-token');
  });
});
