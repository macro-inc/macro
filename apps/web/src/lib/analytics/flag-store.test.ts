import { createMemo, createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFlagStore,
  FLAG_RETRY_DELAYS_MS,
  type FlagClient,
  type FlagValues,
} from './flag-store';

type RecordedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  ended: boolean;
  failed: boolean;
};

const spans = vi.hoisted(() => [] as RecordedSpan[]);

vi.mock('@macro-inc/observability', () => {
  const start = (name: string, options?: { attributes?: object }) => {
    const span: RecordedSpan = {
      name,
      attributes: { ...options?.attributes },
      ended: false,
      failed: false,
    };
    spans.push(span);
    const handle = {
      setAttr: (key: string, value: unknown) => {
        span.attributes[key] = value;
      },
      error: () => {
        span.failed = true;
      },
      end: () => {
        span.ended = true;
      },
      run: <T>(operation: () => T) => operation(),
    };
    return handle;
  };
  return {
    Telemetry: {
      span: (
        name: string,
        options?: { attributes?: object },
        operation?: (span: ReturnType<typeof start>) => Promise<unknown>
      ) => {
        const span = start(name, options);
        if (!operation) return span;
        return (async () => {
          try {
            return await operation(span);
          } finally {
            span.end();
          }
        })();
      },
      error: vi.fn(),
    },
  };
});

const USER = 'macro|flags@example.com';

/** A PostHog client stand-in: its cache and its latest flag errors. */
function postHog(options: { cached?: string[] } = {}) {
  const state = { errors: [] as string[] };
  return {
    state,
    client: {
      onFeatureFlags: vi.fn<FlagClient['onFeatureFlags']>(() => vi.fn()),
      reloadFeatureFlags: vi.fn(),
      get_property: (name: string) =>
        name === '$feature_flag_errors' ? state.errors : undefined,
      featureFlags: { getFlags: () => options.cached ?? [] },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve));
}

/** Reads `key` reactively, as a component would. */
function track(
  store: ReturnType<typeof createFlagStore>,
  key: string,
  readPostHog: () => boolean | undefined
) {
  return createRoot(() =>
    createMemo(() => ({
      settled: store.settled(),
      resolved: store.resolve(key, readPostHog),
    }))
  );
}

beforeEach(() => {
  spans.length = 0;
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('flag store', () => {
  it('reads the backend in parallel on a cold load, then lets PostHog win', async () => {
    const store = createFlagStore();
    const { client } = postHog();
    const backend = deferred<FlagValues>();
    let posthogValue: boolean | undefined;
    const read = track(store, 'enable-crm', () => posthogValue);

    store.connect(client);
    store.setAccount({ userId: USER, fetchFlags: () => backend.promise });
    expect(read().settled).toBe(false);

    backend.resolve({ 'enable-crm': true, 'staff-only': false });
    await settle();
    expect(read()).toEqual({
      settled: true,
      resolved: { enabled: true, source: 'bootstrap' },
    });
    expect(store.resolve('staff-only', () => undefined)).toEqual({
      enabled: false,
      source: 'bootstrap',
    });
    expect(store.resolve('unlisted', () => true)?.enabled).toBe(false);

    posthogValue = false;
    store.receiveRemote(false);
    expect(read().resolved).toEqual({ enabled: false, source: 'remote' });
  });

  it('serves a returning user from the cache and reads the backend only when PostHog fails', async () => {
    const store = createFlagStore();
    const { client, state } = postHog({ cached: ['enable-crm'] });
    const fetchFlags = vi.fn(async () => ({ 'enable-crm': true }));
    const read = track(store, 'enable-crm', () => false);

    store.connect(client);
    store.setAccount({ userId: USER, fetchFlags });
    expect(fetchFlags).not.toHaveBeenCalled();
    expect(read()).toEqual({
      settled: true,
      resolved: { enabled: false, source: 'cache' },
    });

    state.errors = ['timeout'];
    store.receiveRemote(true);
    expect(fetchFlags).toHaveBeenCalledOnce();
    await settle();
    expect(read().resolved).toEqual({ enabled: true, source: 'bootstrap' });
  });

  it('keeps a failed PostHog request loading until the backend answers', async () => {
    const store = createFlagStore();
    const { client } = postHog({ cached: [] });
    const backend = deferred<FlagValues>();
    const read = track(store, 'enable-calendar-ui', () => undefined);

    store.connect(client);
    store.receiveRemote(true);
    expect(read().settled).toBe(true);
    expect(read().resolved).toBeUndefined();

    // Signing in starts the fallback read; flags wait for it again.
    store.setAccount({ userId: USER, fetchFlags: () => backend.promise });
    expect(read().settled).toBe(false);
    backend.resolve({ 'enable-calendar-ui': true });
    await settle();
    expect(read().resolved).toEqual({ enabled: true, source: 'bootstrap' });
  });

  it('degrades to off when PostHog and the backend both fail', async () => {
    const store = createFlagStore();
    const { client, state } = postHog();
    const read = track(store, 'enable-crm', () => undefined);
    store.connect(client);
    store.setAccount({
      userId: USER,
      fetchFlags: async () => {
        throw new Error('503');
      },
    });

    state.errors = ['connection_error'];
    store.receiveRemote(true);
    await settle();
    expect(read()).toEqual({ settled: true, resolved: undefined });
    expect(store.unreachable()).toBe(true);
    const bootstrap = spans.find(
      (span) => span.name === 'feature_flags.bootstrap'
    );
    expect(bootstrap?.attributes['flags.outcome']).toBe('error');
    expect(bootstrap?.failed).toBe(true);
  });

  it('starts from the last backend answer this browser saw for the account', async () => {
    const first = createFlagStore();
    first.connect(postHog().client);
    first.setAccount({
      userId: USER,
      fetchFlags: async () => ({ 'enable-crm': true }),
    });
    await settle();

    const next = createFlagStore();
    next.connect(postHog({ cached: ['enable-crm'] }).client);
    next.setAccount({ userId: USER, fetchFlags: vi.fn() });
    const read = track(next, 'enable-crm', () => false);
    expect(read()).toEqual({
      settled: true,
      resolved: { enabled: true, source: 'persisted_bootstrap' },
    });

    // Another account on the same browser starts from its own.
    next.setAccount({
      userId: 'macro|other@example.com',
      fetchFlags: vi.fn(),
    });
    expect(read().resolved).toEqual({ enabled: false, source: 'cache' });
  });

  it("subscribes to PostHog's answers and lets go on disconnect", async () => {
    const store = createFlagStore();
    const unsubscribe = vi.fn();
    const { client } = postHog();
    client.onFeatureFlags.mockReturnValue(unsubscribe);
    const disconnect = store.connect(client);

    const callback = client.onFeatureFlags.mock.calls[0]?.[0];
    callback?.([], {}, { errorsLoading: true });
    await settle();
    expect(store.unreachable()).toBe(true);

    disconnect();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(
      spans.find((span) => span.name === 'feature_flags.resolve')
    ).toMatchObject({ ended: true });
  });

  it('drops the saved backend answer once PostHog answers, and on sign-out', async () => {
    const key = `feature-flags:bootstrap:v1:${encodeURIComponent(USER)}`;
    const failing = createFlagStore();
    failing.connect(postHog().client);
    failing.receiveRemote(true);
    failing.setAccount({
      userId: USER,
      fetchFlags: async () => ({ 'enable-crm': true }),
    });
    await settle();
    expect(localStorage.getItem(key)).not.toBeNull();

    // A later visit where PostHog answers: its cache is fresher from now on.
    const answering = createFlagStore();
    answering.connect(postHog({ cached: ['enable-crm'] }).client);
    answering.setAccount({ userId: USER, fetchFlags: vi.fn() });
    expect(answering.resolve('enable-crm', () => false)?.source).toBe(
      'persisted_bootstrap'
    );
    answering.receiveRemote(false);
    expect(localStorage.getItem(key)).toBeNull();

    localStorage.setItem(key, JSON.stringify({ 'enable-crm': true }));
    failing.setAccount(undefined);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("doesn't save a backend answer that arrives after PostHog's", async () => {
    const store = createFlagStore();
    store.connect(postHog().client);
    const backend = deferred<FlagValues>();
    store.setAccount({ userId: USER, fetchFlags: () => backend.promise });
    store.receiveRemote(false);
    backend.resolve({ 'enable-crm': true });
    await settle();
    expect(localStorage.length).toBe(0);
  });

  it("treats PostHog's answer for another identity as a cache", async () => {
    const store = createFlagStore();
    const { client } = postHog({ cached: ['enable-crm'] });
    let distinctId = 'anonymous-device';
    const posthog = { ...client, get_distinct_id: () => distinctId };
    store.connect(posthog);
    store.receiveRemote(false);
    const fetchFlags = vi.fn(async () => ({ 'enable-crm': true }));

    store.setAccount({ userId: USER, fetchFlags });
    expect(store.resolve('enable-crm', () => false)?.source).toBe('cache');
    expect(store.settled()).toBe(true);

    // The identify reload fails: the backend answers for this account.
    store.receiveRemote(true);
    expect(fetchFlags).toHaveBeenCalledOnce();
    await settle();
    expect(store.resolve('enable-crm', () => false)).toEqual({
      enabled: true,
      source: 'bootstrap',
    });

    // Then PostHog answers for this account.
    distinctId = USER;
    store.receiveRemote(false);
    expect(store.resolve('enable-crm', () => false)?.source).toBe('remote');
  });

  it('keeps an answer PostHog gave for the same account', () => {
    const store = createFlagStore();
    const { client } = postHog({ cached: ['enable-crm'] });
    store.connect({ ...client, get_distinct_id: () => USER });
    store.receiveRemote(false);
    store.setAccount({ userId: USER, fetchFlags: vi.fn() });
    expect(store.resolve('enable-crm', () => true)?.source).toBe('remote');
  });

  it('drops a backend answer when the account signs out before it applies', async () => {
    const store = createFlagStore();
    store.connect(postHog().client);
    const backend = deferred<FlagValues>();
    store.setAccount({ userId: USER, fetchFlags: () => backend.promise });
    backend.resolve({ 'enable-crm': true });
    await Promise.resolve();
    await Promise.resolve();
    store.setAccount(undefined);
    await settle();
    expect(store.resolve('enable-crm', () => undefined)).toBeUndefined();
  });

  it('applies a late PostHog answer to readers without a reload', () => {
    const store = createFlagStore();
    store.connect(postHog({ cached: [] }).client);
    let posthogValue: boolean | undefined;
    const read = track(store, 'enable-crm', () => posthogValue);

    store.receiveRemote(true);
    expect(read().resolved).toBeUndefined();

    posthogValue = true;
    store.receiveRemote(false);
    expect(read().resolved).toEqual({ enabled: true, source: 'remote' });
    expect(spans.some((span) => span.name === 'feature_flags.recovered')).toBe(
      true
    );

    // An answer earlier this session outranks a later failure.
    store.receiveRemote(true);
    expect(read().resolved).toEqual({ enabled: true, source: 'remote' });
  });

  it('retries a failed request on a schedule and stops after a success', () => {
    vi.useFakeTimers();
    const store = createFlagStore();
    const { client, state } = postHog();
    store.connect(client);

    state.errors = ['timeout'];
    store.receiveRemote(true);
    vi.advanceTimersByTime(FLAG_RETRY_DELAYS_MS[0] - 1);
    expect(client.reloadFeatureFlags).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(client.reloadFeatureFlags).toHaveBeenCalledOnce();

    store.receiveRemote(true);
    vi.advanceTimersByTime(FLAG_RETRY_DELAYS_MS[1]);
    expect(client.reloadFeatureFlags).toHaveBeenCalledTimes(2);

    // The schedule is spent; PostHog's own refresh takes over.
    store.receiveRemote(true);
    vi.advanceTimersByTime(60_000);
    expect(client.reloadFeatureFlags).toHaveBeenCalledTimes(2);

    const attempts = spans.filter((span) => span.name === 'feature_flags.load');
    expect(attempts.map((span) => span.attributes['flags.attempt'])).toEqual([
      1, 2, 3,
    ]);
    expect(attempts.every((span) => span.ended)).toBe(true);
    expect(attempts[0]?.attributes['flags.outcome']).toBe('timeout');
  });

  it("doesn't stack retries on PostHog's own failed reloads", () => {
    vi.useFakeTimers();
    const store = createFlagStore();
    const { client } = postHog();
    store.connect(client);

    store.receiveRemote(true);
    // An identify reload that failed too, before the retry went out.
    store.receiveRemote(true);
    vi.advanceTimersByTime(FLAG_RETRY_DELAYS_MS[0]);
    expect(client.reloadFeatureFlags).toHaveBeenCalledOnce();
  });

  it('ends a retry PostHog never sent as blocked', () => {
    vi.useFakeTimers();
    const store = createFlagStore();
    const { client } = postHog();
    store.connect(client);

    store.receiveRemote(true);
    vi.advanceTimersByTime(FLAG_RETRY_DELAYS_MS[0]);
    expect(client.reloadFeatureFlags).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(15_000);

    const retry = spans.filter((span) => span.name === 'feature_flags.load')[1];
    expect(retry).toMatchObject({
      ended: true,
      attributes: {
        'flags.attempt': 2,
        'flags.outcome': 'blocked',
        'flags.errors': 'not_sent',
      },
    });
  });

  it('does not retry once PostHog has answered', () => {
    vi.useFakeTimers();
    const store = createFlagStore();
    const { client } = postHog();
    store.connect(client);

    store.receiveRemote(false);
    store.receiveRemote(true);
    vi.advanceTimersByTime(60_000);
    expect(client.reloadFeatureFlags).not.toHaveBeenCalled();
  });

  it.each([
    [['timeout'], true, 'timeout'],
    [['connection_error'], true, 'blocked'],
    [['connection_error'], false, 'error'],
    [['api_error_503'], true, 'error'],
  ] as const)('records %s while online=%s as %s', (errors, online, outcome) => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
    const store = createFlagStore();
    const { client, state } = postHog();
    store.connect(client);
    state.errors = [...errors];
    store.receiveRemote(true);

    const load = spans.find((span) => span.name === 'feature_flags.load');
    expect(load?.attributes).toMatchObject({
      'flags.attempt': 1,
      'flags.outcome': outcome,
      'flags.errors': errors.join(','),
      'flags.online': online,
    });
    vi.restoreAllMocks();
  });

  it('records which source first answered', async () => {
    const store = createFlagStore();
    store.connect(postHog().client);
    store.setAccount({
      userId: USER,
      fetchFlags: async () => ({ 'enable-crm': true }),
    });
    await settle();
    store.receiveRemote(false);

    const resolve = spans.filter(
      (span) => span.name === 'feature_flags.resolve'
    );
    expect(resolve).toHaveLength(1);
    expect(resolve[0]).toMatchObject({
      ended: true,
      attributes: {
        'flags.source': 'bootstrap',
        'flags.remote': 'pending',
        'flags.had_cache': false,
      },
    });
  });

  it('ignores a backend answer for an account that has since signed out', async () => {
    const store = createFlagStore();
    store.connect(postHog().client);
    const backend = deferred<FlagValues>();
    store.setAccount({ userId: USER, fetchFlags: () => backend.promise });
    store.setAccount(undefined);

    backend.resolve({ 'enable-crm': true });
    await settle();
    expect(store.resolve('enable-crm', () => undefined)).toBeUndefined();
  });

  it('waits for a fresh answer before a one-time decision', async () => {
    vi.useFakeTimers();
    const store = createFlagStore();
    store.connect(postHog({ cached: ['enable-browser-otel'] }).client);
    let done = false;
    const answered = (async () => {
      await store.whenAnswered(15_000);
      done = true;
    })();

    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    store.receiveRemote(false);
    await answered;
    expect(done).toBe(true);

    const timedOut = createFlagStore();
    timedOut.connect(postHog().client);
    const waiting = timedOut.whenAnswered(15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    await waiting;
  });
});
