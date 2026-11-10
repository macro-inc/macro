import { PasswordErrorCode } from '@service-storage/generated/schemas/passwordErrorCode';
import type { PasswordItemMetadata } from '@service-storage/generated/schemas/passwordItemMetadata';
import type { PasswordWriteItem } from '@service-storage/generated/schemas/passwordWriteItem';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPasswordSource } from '../queries/source';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refresh: vi.fn(),
  attributes: vi.fn(),
}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_BEARER_TOKEN_AUTH: false,
}));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'document-storage-service': 'https://storage.example.test' },
  SYNC_SERVICE_HOSTS: { worker: 'https://sync.example.test' },
}));
vi.mock('@core/util/platformFetch', () => ({ platformFetch: mocks.fetch }));
vi.mock('@core/auth/session-refresh', () => ({
  fetchToken: mocks.refresh,
  unsetTokenPromise: vi.fn(),
  ensureFreshSession: vi.fn(),
  confirmSessionExpired: vi.fn(),
}));
vi.mock('@service-auth/fetch', () => ({ fetchWithAuth: vi.fn() }));
vi.mock('@macro-inc/observability', () => {
  const span = {
    run: <T>(operation: () => T) => operation(),
    setAttr: mocks.attributes,
    error: vi.fn(),
    end: vi.fn(),
    injectTraceHeaders: vi.fn(),
    traceparent: () => undefined,
  };
  return {
    Telemetry: {
      span: (
        _name: string,
        operation?: ((current: typeof span) => Promise<unknown>) | object
      ) => (typeof operation === 'function' ? operation(span) : span),
      captureContext: () => span,
      error: vi.fn(),
    },
  };
});

const disclosed = {
  version: 1,
  values: {
    username: 'account',
    password: 'synthetic-secret',
    notes: '',
    fields: [],
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.refresh.mockResolvedValue(ok('new-session'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('shows fresh sign-in for the typed stale-auth response without refreshing or duplicating disclosure', async () => {
  mocks.fetch.mockResolvedValue(
    new Response(
      JSON.stringify({ code: PasswordErrorCode.reauthentication_required }),
      { status: 403 }
    )
  );
  const result = await createPasswordSource('team').reveal('item');
  expect(result.isErr() && result.error).toBe('reauth');
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it('preserves cookie refresh for an expired session and keeps ordinary permission denials separate', async () => {
  mocks.fetch
    .mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(disclosed), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  expect((await createPasswordSource('team').reveal('item')).isOk()).toBe(true);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  mocks.fetch.mockClear();
  mocks.refresh.mockClear();
  mocks.fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ code: PasswordErrorCode.forbidden }), {
      status: 403,
    })
  );
  const result = await createPasswordSource('team').reveal('item');
  expect(result.isErr() && result.error).toBe('failed');
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it('bounds busy retries with jittered exponential backoff and records their count without credential values', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(1);
  const started = Date.now();
  const attempts: number[] = [];
  mocks.fetch.mockImplementation(async () => {
    attempts.push(Date.now() - started);
    return new Response(
      JSON.stringify({ code: PasswordErrorCode.vault_busy }),
      { status: 409 }
    );
  });
  const pending = createPasswordSource('team').reveal('item');
  await vi.advanceTimersByTimeAsync(1000);
  const result = await pending;
  expect(result.isErr() && result.error).toBe('failed');
  expect(attempts).toEqual([0, 50, 350]);
  expect(
    mocks.attributes.mock.calls
      .filter(([name]) => name === 'retry.count')
      .map(([, value]) => value)
  ).toEqual([0, 1, 2]);
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(JSON.stringify(mocks.attributes.mock.calls)).not.toContain(
    'synthetic-secret'
  );
});

it('retries contention successfully with the same payload but never retries a revision conflict', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const metadata: PasswordItemMetadata = {
    id: 'item',
    teamId: 'team',
    name: 'Credential',
    kind: 'login',
    url: null,
    folderId: null,
    favorite: false,
    version: 1,
    hasTotp: false,
    shared: false,
    shareCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastUsedAt: null,
  };
  const draft = {
    name: 'Credential',
    kind: metadata.kind,
    url: '',
    folderId: null,
    favorite: false,
    values: {
      username: 'account',
      password: 'original-secret',
      notes: '',
      fields: [],
    },
  };
  mocks.fetch
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: PasswordErrorCode.vault_busy }), {
        status: 409,
      })
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(metadata), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  const operationId = '019a0000-0000-7000-8000-000000000001';
  const pending = createPasswordSource('team').save(
    undefined,
    undefined,
    draft,
    operationId
  );
  draft.values.password = 'edited-after-submit';
  await vi.advanceTimersByTimeAsync(1000);
  expect((await pending).isOk()).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.fetch.mock.calls[0][1].body).toBe(
    mocks.fetch.mock.calls[1][1].body
  );
  const submitted: PasswordWriteItem = JSON.parse(
    mocks.fetch.mock.calls[1][1].body
  );
  expect(submitted.operationId).toBe(operationId);
  expect(submitted.values.password).toBe('original-secret');
  expect(JSON.stringify(mocks.attributes.mock.calls)).not.toContain(
    'original-secret'
  );
  mocks.fetch.mockClear();
  mocks.fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ code: PasswordErrorCode.version_conflict }), {
      status: 409,
    })
  );
  const conflict = await createPasswordSource('team').reveal('item');
  expect(conflict.isErr() && conflict.error).toBe('failed');
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
