import { PasswordErrorCode } from '@service-storage/generated/schemas/passwordErrorCode';
import type { PasswordItemMetadata } from '@service-storage/generated/schemas/passwordItemMetadata';
import type { PasswordWriteItem } from '@service-storage/generated/schemas/passwordWriteItem';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ImportBatchBody } from '../context/passwords-context';
import {
  createPasswordSource,
  isServiceUnavailable,
  isUnreachable,
} from '../queries/source';

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

it('never replays a request under another account after a delayed session refresh', async () => {
  let finishRefresh: ((value: ReturnType<typeof ok<void>>) => void) | undefined;
  let refreshStarted: (() => void) | undefined;
  const refreshing = new Promise<void>((resolve) => {
    refreshStarted = resolve;
  });
  mocks.refresh.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRefresh = resolve;
        refreshStarted?.();
      })
  );
  mocks.fetch.mockResolvedValue(new Response('', { status: 401 }));
  const viewer = new AbortController();
  let current = true;
  const source = createPasswordSource('team', {
    isCurrent: () => current,
    signal: viewer.signal,
  });
  const pending = source.share('item', [
    { kind: 'team', id: 'team', permission: 'view' },
  ]);
  await refreshing;
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  // Account A signs out and B signs in while A's refresh is still pending.
  current = false;
  viewer.abort();
  finishRefresh?.(ok(undefined));
  const result = await pending;
  expect(result.isErr()).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(await source.list().catch(() => 'refused')).toBe('refused');
  expect(await source.folders().catch(() => 'refused')).toBe('refused');
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
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
  expect(
    (await createPasswordSource('team', CURRENT).reveal('item')).isOk()
  ).toBe(true);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  mocks.fetch.mockClear();
  mocks.refresh.mockClear();
  mocks.fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ code: PasswordErrorCode.forbidden }), {
      status: 403,
    })
  );
  const result = await createPasswordSource('team', CURRENT).reveal('item');
  expect(result.isErr() && result.error).toBe('failed');
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it('bounds busy retries with jittered exponential backoff and records their count without credential values', async () => {
  vi.useFakeTimers();
  const busy = async () =>
    new Response(JSON.stringify({ code: PasswordErrorCode.vault_busy }), {
      status: 409,
    });
  // The shortest and longest jitter bound the total wait at 1.5 and 4.5 seconds.
  for (const [jitter, expected] of [
    [0, [0, 100, 300, 700, 1500]],
    [1, [0, 300, 900, 2100, 4500]],
  ] as const) {
    mocks.fetch.mockReset();
    mocks.attributes.mockReset();
    vi.spyOn(Math, 'random').mockReturnValue(jitter);
    const started = Date.now();
    const attempts: number[] = [];
    mocks.fetch.mockImplementation(async () => {
      attempts.push(Date.now() - started);
      return busy();
    });
    const pending = createPasswordSource('team', CURRENT).reveal('item');
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;
    expect(result.isErr() && result.error).toBe('failed');
    expect(attempts).toEqual(expected);
    expect(
      mocks.attributes.mock.calls
        .filter(([name]) => name === 'retry.count')
        .map(([, value]) => value)
    ).toEqual([0, 1, 2, 3, 4]);
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(JSON.stringify(mocks.attributes.mock.calls)).not.toContain(
    'synthetic-secret'
  );
});

it('succeeds after three busy answers within the retry budget', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  for (let attempt = 0; attempt < 3; attempt++)
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: PasswordErrorCode.vault_busy }), {
        status: 409,
      })
    );
  mocks.fetch.mockResolvedValueOnce(
    new Response(JSON.stringify(disclosed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  const pending = createPasswordSource('team', CURRENT).reveal('item');
  await vi.advanceTimersByTimeAsync(1000);
  expect((await pending).isOk()).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledTimes(4);
});

it('sends nothing more once the viewer changes during a busy backoff', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  let answered: (() => void) | undefined;
  const firstAnswer = new Promise<void>((resolve) => {
    answered = resolve;
  });
  mocks.fetch.mockImplementation(async () => {
    answered?.();
    return new Response(
      JSON.stringify({ code: PasswordErrorCode.vault_busy }),
      { status: 409 }
    );
  });
  const viewer = new AbortController();
  let current = true;
  const pending = createPasswordSource('team', {
    isCurrent: () => current,
    signal: viewer.signal,
  }).save(
    undefined,
    undefined,
    {
      name: 'Credential',
      kind: 'login',
      url: '',
      folderId: null,
      favorite: false,
      private: false,
      values: {
        username: '',
        password: 'synthetic-secret',
        notes: '',
        fields: [],
      },
    },
    '019a0000-0000-7000-8000-000000000002'
  );
  await firstAnswer;
  // The account changes while the first retry is waiting.
  current = false;
  viewer.abort();
  await vi.advanceTimersByTimeAsync(5000);
  const result = await pending;
  expect(result.isErr() && result.error).toBe('failed');
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it('drops a busy answer that arrives after the viewer changed without waiting out a backoff', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  let answer: ((response: Response) => void) | undefined;
  let sent: (() => void) | undefined;
  const requested = new Promise<void>((resolve) => {
    sent = resolve;
  });
  mocks.fetch.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
        sent?.();
      })
  );
  let current = true;
  let settled = false;
  const source = createPasswordSource('team', {
    isCurrent: () => current,
    signal: new AbortController().signal,
  });
  const pending = (async () => {
    const result = await source.reveal('item');
    settled = true;
    return result;
  })();
  await requested;
  current = false;
  answer?.(
    new Response(JSON.stringify({ code: PasswordErrorCode.vault_busy }), {
      status: 409,
    })
  );
  // No timer advances: a retiring viewer never sits through the backoff.
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(true);
  const result = await pending;
  expect(result.isErr() && result.error).toBe('failed');
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
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
    sharedWithTeam: true,
    canManage: true,
    canEdit: true,
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
    private: false,
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
  const pending = createPasswordSource('team', CURRENT).save(
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
  const conflict = await createPasswordSource('team', CURRENT).reveal('item');
  expect(conflict.isErr() && conflict.error).toBe('failed');
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it('chooses team or private sharing only when an item is created', async () => {
  const metadata = {
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
    sharedWithTeam: false,
    canManage: true,
    canEdit: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastUsedAt: null,
  };
  mocks.fetch.mockImplementation(
    async () =>
      new Response(JSON.stringify(metadata), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
  );
  const draft = {
    name: 'Credential',
    kind: 'login' as const,
    url: '',
    folderId: null,
    favorite: false,
    private: true,
    values: { username: '', password: 'secret', notes: '', fields: [] },
  };
  const source = createPasswordSource('team', CURRENT);
  await source.save(
    undefined,
    undefined,
    draft,
    '019a0000-0000-7000-8000-000000000030'
  );
  await source.save('item', 1, draft, '019a0000-0000-7000-8000-000000000031');
  const [created, updated] = mocks.fetch.mock.calls.map(([, init]) =>
    JSON.parse(init.body)
  );
  expect(created.private).toBe(true);
  expect('private' in updated).toBe(false);
});

function codeResponse(code: string) {
  return new Response(JSON.stringify({ code, period: 30 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

it('never advertises a verification code that may come from the previous period', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:29.500Z'));
  let finishFirst: ((response: Response) => void) | undefined;
  let firstStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  mocks.fetch
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishFirst = resolve;
          firstStarted?.();
        })
    )
    .mockImplementationOnce(async () => codeResponse('222222'));
  const pending = createPasswordSource('team', CURRENT).totp('item');
  await started;
  // The server produced this code at :29.5; it arrives after the period ends.
  vi.setSystemTime(new Date('2026-01-01T00:00:30.200Z'));
  finishFirst?.(codeResponse('111111'));
  const result = await pending;
  expect(result.isOk() && result.value).toEqual({
    code: '222222',
    period: 30,
    validUntil: '2026-01-01T00:01:00.000Z',
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it('fails instead of publishing a code when retries keep crossing a period boundary', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  let now = Date.parse('2026-01-01T00:00:29.900Z');
  vi.setSystemTime(now);
  mocks.fetch.mockImplementation(async () => {
    now += 30_000;
    vi.setSystemTime(now);
    return codeResponse('333333');
  });
  const result = await createPasswordSource('team', CURRENT).totp('item');
  expect(result.isErr() && result.error).toBe('failed');
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it('marks a failed folder request in its action trace without recording its name', async () => {
  mocks.fetch.mockResolvedValue(new Response('{}', { status: 503 }));
  const source = createPasswordSource('fixture-team', CURRENT);
  const result = await source.createFolder(
    'Synthetic private folder',
    'parent-folder'
  );
  expect(result.isErr()).toBe(true);
  expect(mocks.spanError).toHaveBeenCalledWith(
    'passwords.folder.create failed'
  );
  expect(mocks.attributes).toHaveBeenCalledWith(
    'passwords.outcome',
    'serviceUnavailable'
  );
  expect(JSON.stringify(mocks.attributes.mock.calls)).not.toContain(
    'Synthetic private folder'
  );
});

it('keeps agent grants out of the human sharing contract', async () => {
  const humanGrants = [
    { kind: 'user', id: 'macro|viewer@example.test', permission: 'edit' },
    { kind: 'team', id: 'team', permission: 'view' },
  ];
  mocks.fetch.mockResolvedValueOnce(
    new Response(
      JSON.stringify([
        ...humanGrants,
        { kind: 'agent', id: 'macro|agent@example.test', permission: 'edit' },
      ]),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  );

  const result = await createPasswordSource('team', CURRENT).grants('item');
  expect(result.isOk()).toBe(true);
  expect(result.isOk() && result.value).toEqual(humanGrants);
});

it('tells an unreachable vault from a server error and a rejected batch', async () => {
  const batch = {
    format: 'bitwarden_json',
    target: { kind: 'root' },
    private: false,
    folders: [],
    items: [],
  } satisfies ImportBatchBody;
  const answers = [
    [
      new Response('', { status: 502 }),
      { retryable: true, reason: 'unreachable' },
    ],
    [
      new Response('', { status: 504 }),
      { retryable: true, reason: 'unreachable' },
    ],
    [
      new Response('', { status: 500 }),
      { retryable: true, reason: 'server_error' },
    ],
    [
      new Response('', { status: 503 }),
      { retryable: true, reason: 'server_error' },
    ],
    [
      new Response(
        JSON.stringify({ code: PasswordErrorCode.vault_unavailable }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ),
      { retryable: true, reason: 'server_error' },
    ],
    [
      new Response(JSON.stringify({ code: PasswordErrorCode.forbidden }), {
        status: 403,
      }),
      { retryable: false, reason: 'refused' },
    ],
    [
      new Response(
        JSON.stringify({ code: PasswordErrorCode.vault_not_provisioned }),
        { status: 409 }
      ),
      { retryable: false, reason: 'not_provisioned' },
    ],
  ] as const;
  for (const [response, failure] of answers) {
    mocks.fetch.mockResolvedValueOnce(response);
    const result = await createPasswordSource('team', CURRENT).importBatch(
      'import',
      batch
    );
    expect(result.isErr() && result.error).toEqual(failure);
  }
  mocks.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const offline = await createPasswordSource('team', CURRENT).importBatch(
    'import',
    batch
  );
  expect(offline.isErr() && offline.error).toEqual({
    retryable: true,
    reason: 'unreachable',
  });
});

it('keeps username failure visible and records its fixed code on the action span', async () => {
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ code: PasswordErrorCode.version_conflict }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  const result = await createPasswordSource('team', CURRENT).username('item');
  expect(result.isErr()).toBe(true);
  expect(mocks.attributes).toHaveBeenCalledWith(
    'passwords.error_code',
    PasswordErrorCode.version_conflict
  );
  expect(mocks.spanError).toHaveBeenCalledWith('passwords.username failed');
});

it('accepts an empty username response without a failure', async () => {
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ username: '', version: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  const result = await createPasswordSource('team', CURRENT).username('item');
  expect(result.isOk() && result.value).toEqual({ username: '', version: 1 });
  expect(mocks.spanError).not.toHaveBeenCalled();
});

it('reports an unreachable vault on a username read as unreachable, with its code on the span', async () => {
  mocks.fetch.mockResolvedValueOnce(new Response('', { status: 502 }));
  const gateway = await createPasswordSource('team', CURRENT).username('item');
  expect(gateway.isErr() && gateway.error).toBe('unreachable');
  expect(mocks.attributes).toHaveBeenCalledWith(
    'passwords.error_code',
    'NETWORK_ERROR'
  );
  expect(mocks.spanError).toHaveBeenCalledWith('passwords.username failed');
  mocks.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const offline = await createPasswordSource('team', CURRENT).username('item');
  expect(offline.isErr() && offline.error).toBe('unreachable');
});

it('refreshes an expired session once and retries the username read', async () => {
  mocks.fetch
    .mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ username: 'account', version: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  const result = await createPasswordSource('team', CURRENT).username('item');
  expect(result.isOk() && result.value).toEqual({
    username: 'account',
    version: 1,
  });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.spanError).not.toHaveBeenCalledWith('passwords.username failed');
});

it('tells a list behind an unreachable gateway from other list failures', async () => {
  mocks.fetch.mockResolvedValueOnce(new Response('', { status: 502 }));
  const gateway = await createPasswordSource('team', CURRENT)
    .list()
    .catch((error: unknown) => error);
  expect(isUnreachable(gateway)).toBe(true);
  mocks.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const offline = await createPasswordSource('team', CURRENT)
    .folders()
    .catch((error: unknown) => error);
  expect(isUnreachable(offline)).toBe(true);
  mocks.fetch.mockResolvedValueOnce(new Response('', { status: 500 }));
  const broken = await createPasswordSource('team', CURRENT)
    .list()
    .catch((error: unknown) => error);
  expect(isUnreachable(broken)).toBe(false);
});

it('sets and removes a private favorite with no credential payload and accepts 204', async () => {
  mocks.fetch.mockImplementation(() =>
    Promise.resolve(new Response(null, { status: 204 }))
  );
  const source = createPasswordSource('team', CURRENT);
  expect((await source.setFavorite('item', true)).isOk()).toBe(true);
  expect((await source.setFavorite('item', false)).isOk()).toBe(true);
  const requests = mocks.fetch.mock.calls.map(([url, options]) => ({
    url: String(url),
    method: options.method,
    body: options.body,
  }));
  expect(requests).toEqual([
    {
      url: 'https://storage.example.test/passwords/teams/team/items/item/favorite',
      method: 'PUT',
      body: undefined,
    },
    {
      url: 'https://storage.example.test/passwords/teams/team/items/item/favorite',
      method: 'DELETE',
      body: undefined,
    },
  ]);
});

it('tells a gateway that got no answer from a service that answered 503', async () => {
  const username = async (answer: Response | TypeError) => {
    if (answer instanceof TypeError) mocks.fetch.mockRejectedValueOnce(answer);
    else mocks.fetch.mockResolvedValueOnce(answer);
    const result = await createPasswordSource('team', CURRENT).username('item');
    return result.isErr() && result.error;
  };
  const json = (status: number, code: string) =>
    new Response(JSON.stringify({ code }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  expect(await username(new TypeError('Failed to fetch'))).toBe('unreachable');
  expect(await username(new Response('', { status: 502 }))).toBe('unreachable');
  expect(await username(new Response('', { status: 504 }))).toBe('unreachable');
  expect(await username(json(503, PasswordErrorCode.vault_unavailable))).toBe(
    'serviceUnavailable'
  );
  expect(mocks.attributes).toHaveBeenCalledWith(
    'passwords.error_code',
    PasswordErrorCode.vault_unavailable
  );
  expect(await username(new Response('', { status: 503 }))).toBe(
    'serviceUnavailable'
  );
  expect(mocks.attributes).toHaveBeenCalledWith(
    'passwords.error_code',
    'SERVICE_UNAVAILABLE'
  );
  expect(await username(json(503, PasswordErrorCode.folder_missing))).toBe(
    'folderMissing'
  );
  expect(await username(json(409, PasswordErrorCode.folder_missing))).toBe(
    'folderMissing'
  );
  expect(await username(json(403, PasswordErrorCode.forbidden))).toBe('failed');
});

it('tells a list the service could not serve from one behind an unreachable gateway', async () => {
  mocks.fetch.mockResolvedValueOnce(new Response('', { status: 504 }));
  const gateway = await createPasswordSource('team', CURRENT)
    .list()
    .catch((error: unknown) => error);
  expect(isUnreachable(gateway)).toBe(true);
  expect(isServiceUnavailable(gateway)).toBe(false);
  mocks.fetch.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ code: PasswordErrorCode.vault_unavailable }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  );
  const service = await createPasswordSource('team', CURRENT)
    .list()
    .catch((error: unknown) => error);
  expect(isUnreachable(service)).toBe(false);
  expect(isServiceUnavailable(service)).toBe(true);
  mocks.fetch.mockResolvedValueOnce(new Response('', { status: 503 }));
  const bare = await createPasswordSource('team', CURRENT)
    .folders()
    .catch((error: unknown) => error);
  expect(isUnreachable(bare)).toBe(false);
  expect(isServiceUnavailable(bare)).toBe(true);
});

it("tells a team whose vault isn't set up from a failed action", async () => {
  mocks.fetch.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ code: PasswordErrorCode.vault_not_provisioned }),
      { status: 409 }
    )
  );
  const source = createPasswordSource('fixture-team', CURRENT);
  const result = await source.reveal('fixture-item');
  expect(result.isErr() && result.error).toBe('notProvisioned');
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
