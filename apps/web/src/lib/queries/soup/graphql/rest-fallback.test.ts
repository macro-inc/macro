import { beforeEach, expect, it, vi } from 'vitest';

const fallbackSpan = vi.hoisted(() => ({ error: vi.fn(), setAttr: vi.fn() }));
const telemetry = vi.hoisted(() => ({
  warn: vi.fn(),
  span: vi.fn(
    async (
      _name: string,
      _options: unknown,
      operation: (span: typeof fallbackSpan) => Promise<unknown>
    ) => await operation(fallbackSpan)
  ),
}));
vi.mock('@macro-inc/observability', () => ({ Telemetry: telemetry }));

const { resetSoupRestFallbackLog, soupRestFallback, traceSoupRestFallback } =
  await import('./rest-fallback');

const SECRET_ID = '11111111-2222-3333-4444-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  resetSoupRestFallbackLog();
});

it('has no fallback for a request GraphQL can answer', () => {
  expect(
    soupRestFallback({
      params: { limit: 10, sort_method: 'updated_at' },
      body: { df: { l: { id: SECRET_ID } } },
    })
  ).toBeUndefined();
});

it('names the reason and shape of an untranslatable request without values', () => {
  const fallback = soupRestFallback({
    params: { limit: 10, sort_method: 'frecency' },
    body: { df: { l: { id: SECRET_ID } }, emailView: 'inbox' },
  });
  expect(fallback).toEqual({
    reason: 'sort_method frecency',
    shape: 'sort=frecency group=none view=inbox targets=df',
  });
  expect(JSON.stringify(fallback)).not.toContain(SECRET_ID);
});

it.each([
  ['document subType', { df: { l: { dst: SECRET_ID } } }],
  ['file association', { df: { l: { fa: `assoc:${SECRET_ID}` } } }],
  ['email view', { emailView: SECRET_ID }],
  ['literal key', { calf: { l: { [SECRET_ID]: true } } }],
  // A key that reads like a name is a value too.
  ['named literal key', { df: { l: { SecretName: true } } }],
  ['CRM association key', { crma: { SecretName: 'id' } }],
])(
  'keeps a rejected %s out of the fallback reason and shape',
  (_case, body) => {
    const fallback = soupRestFallback({
      params: { limit: 10, sort_method: 'updated_at' },
      body: body as never,
    });
    expect(fallback).toBeDefined();
    expect(JSON.stringify(fallback)).not.toContain(SECRET_ID);
    expect(JSON.stringify(fallback)).not.toContain('SecretName');
  }
);

it('logs the fallback warning inside its span', async () => {
  const order: string[] = [];
  telemetry.span.mockImplementationOnce(async (_name, _options, operation) => {
    order.push('span');
    return await operation(fallbackSpan);
  });
  telemetry.warn.mockImplementationOnce(() => {
    order.push('warn');
  });
  await traceSoupRestFallback(
    { reason: 'sort_method frecency', shape: 'sort=frecency' },
    'flat',
    async () => 'page'
  );
  expect(order).toEqual(['span', 'warn']);
});

it('spans every fallback read and logs each shape once', async () => {
  const fallback = { reason: 'sort_method frecency', shape: 'sort=frecency' };
  await expect(
    traceSoupRestFallback(fallback, 'flat', async () => 'page')
  ).resolves.toBe('page');
  await traceSoupRestFallback(fallback, 'flat', async () => 'page');

  expect(telemetry.span).toHaveBeenCalledTimes(2);
  expect(telemetry.span).toHaveBeenCalledWith(
    'soup.rest_fallback',
    {
      kind: 'client',
      attributes: {
        'soup.fallback.reason': 'sort_method frecency',
        'soup.fallback.shape': 'sort=frecency',
        'soup.fallback.kind': 'flat',
      },
    },
    expect.any(Function)
  );
  expect(telemetry.warn).toHaveBeenCalledExactlyOnceWith(
    'soup.rest_fallback',
    expect.objectContaining({ 'soup.fallback.kind': 'flat' })
  );
});

it('marks a cancelled fallback read as cancelled, not failed', async () => {
  const fallback = { reason: 'sort_method frecency', shape: 'sort=frecency' };
  const controller = new AbortController();
  controller.abort();
  const cancelled = new Error('request cancelled');
  await expect(
    traceSoupRestFallback(
      fallback,
      'flat',
      async () => {
        throw cancelled;
      },
      controller.signal
    )
  ).rejects.toBe(cancelled);
  expect(fallbackSpan.setAttr).toHaveBeenCalledWith(
    'soup.fallback.cancelled',
    true
  );
  expect(fallbackSpan.error).not.toHaveBeenCalled();

  const failure = new Error('server error');
  await expect(
    traceSoupRestFallback(fallback, 'flat', async () => {
      throw failure;
    })
  ).rejects.toBe(failure);
  expect(fallbackSpan.error).toHaveBeenCalledWith(failure);
});
