import { fetchWithToken } from '@core/util/fetchWithToken';
import { Telemetry } from '@macro-inc/observability';
import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { universalInputClient } from './universal-input';

vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'agent-harness': 'https://harness.example.com' },
  SYNC_SERVICE_HOSTS: { worker: 'https://sync.example.com' },
}));
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it('passes the explicit inference parent across the HTTP boundary', async () => {
  vi.mocked(fetchWithToken).mockResolvedValue(
    ok({
      revision: 1,
      intent: 'note',
      suggestions: { title: 'Note', body: 'Body' },
    })
  );
  const parent = Telemetry.span('test');
  await universalInputClient.extract(
    'Note body',
    'note',
    1,
    [],
    undefined,
    parent
  );
  expect(fetchWithToken).toHaveBeenCalledWith(
    expect.stringContaining('/universal_input/extract'),
    expect.objectContaining({
      trace: { parentSpan: parent },
      signal: expect.any(AbortSignal),
    })
  );
  parent.end();
});

it.each([
  [400, 'INVALID_REQUEST'],
  [402, 'ALLOWANCE_EXHAUSTED'],
  [429, 'RATE_LIMITED'],
  [502, 'UNAVAILABLE'],
  [503, 'UNAVAILABLE'],
] as const)(
  'categorizes HTTP %i without reading its response body',
  async (status, code) => {
    vi.mocked(fetchWithToken).mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'private server text' }])
    );
    await expect(
      universalInputClient.classify('private draft', 1)
    ).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    const handler =
      vi.mocked(fetchWithToken).mock.calls[0][1]?.errorResponseHandler;
    expect(handler).toBeDefined();
    const response = new Response('private server text', { status });
    expect(await handler!(response)).toEqual({ code, message: code });
    expect(response.bodyUsed).toBe(false);
  }
);

it('rejects malformed success payloads with a static error', async () => {
  vi.mocked(fetchWithToken).mockResolvedValue(
    ok({ revision: 'private response data', scores: [] })
  );
  const result = universalInputClient.classify('private draft', 1);
  await expect(result).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  await expect(result).rejects.not.toThrow('private');
});
