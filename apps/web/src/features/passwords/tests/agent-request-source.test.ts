import { PasswordAgentErrorCode } from '@service-storage/generated/schemas/passwordAgentErrorCode';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAgentRequestSource } from '../queries/agent-requests';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refresh: vi.fn(),
  attributes: vi.fn(),
  spanError: vi.fn(),
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
    error: mocks.spanError,
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

const CURRENT = {
  isCurrent: () => true,
  signal: new AbortController().signal,
};

const conflict = (code: PasswordAgentErrorCode) => async () =>
  new Response(JSON.stringify({ code }), { status: 409 });
const resolved = {
  requestId: 'request',
  itemId: 'item',
  agentAccountId: 'macro|agent@example.test',
  permission: 'view',
  status: 'approved',
  revision: 4,
  updatedAt: '2026-01-02T00:00:00Z',
  access: {
    status: 'granted',
    useBasis: 'approved_grant',
    canUpdate: false,
    canSetTotp: false,
    permissionRevision: 2,
    pendingRequestId: null,
  },
};
const decide = () =>
  createAgentRequestSource('team', CURRENT).resolve('item', 'request', {
    decision: 'approve',
    revision: 3,
    permission: 'view',
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.refresh.mockResolvedValue(ok('new-session'));
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('retries a busy vault with the same decision until it answers', async () => {
  mocks.fetch
    .mockImplementationOnce(conflict(PasswordAgentErrorCode.vault_busy))
    .mockImplementationOnce(conflict(PasswordAgentErrorCode.vault_busy))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(resolved), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

  const pending = decide();
  await vi.advanceTimersByTimeAsync(1000);

  expect((await pending).isOk()).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
  const bodies = mocks.fetch.mock.calls.map(([, init]) => init?.body);
  expect(new Set(bodies).size).toBe(1);
});

it('reports a vault that stays busy as a failure, not a stale request', async () => {
  mocks.fetch.mockImplementation(conflict(PasswordAgentErrorCode.vault_busy));

  const pending = decide();
  await vi.advanceTimersByTimeAsync(5000);

  const result = await pending;
  expect(result.isErr() && result.error).toBe('failed');
  expect(mocks.fetch).toHaveBeenCalledTimes(5);
});

it('reports a changed revision as stale without retrying', async () => {
  mocks.fetch.mockImplementation(
    conflict(PasswordAgentErrorCode.version_conflict)
  );

  const result = await decide();

  expect(result.isErr() && result.error).toBe('stale');
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
