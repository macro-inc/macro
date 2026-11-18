import type {
  CacheAuthority,
  CacheAuthorityHost,
} from '@graphql-cache/authority';
import {
  createAuthorityObserver,
  StaleCacheAuthorityError,
} from '@graphql-cache/authority';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCrmAccessAuthority } from './crm-access-authority';

const team = '00000000-0000-4000-8000-000000000001';
afterEach(() => vi.useRealTimers());
function sharedOwner(account: string | null = 'viewer') {
  let state: CacheAuthority = {
    identity: 'anonymous-profile',
    account,
    generation: crypto.randomUUID(),
    policy: null,
    ready: false,
  };
  const listeners = new Set<(state: CacheAuthority) => void>();
  const port = (): CacheAuthorityHost => {
    let guard = async () => {};
    return {
      snapshot: () => state,
      current: async () => state,
      setReadGuard: (value) => {
        guard = async () => {
          await value();
        };
      },
      verifyRead: () => guard(),
      onChanged(callback) {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
      async transition(expected, policy) {
        if (expected !== state.generation) throw new StaleCacheAuthorityError();
        const changed = !state.ready || policy !== state.policy;
        if (changed) {
          state = {
            ...state,
            generation: crypto.randomUUID(),
            policy,
            ready: true,
          };
          for (const listener of listeners) listener(state);
        }
        return { authority: state, revision: '0', affectedOps: [], changed };
      },
    };
  };
  return {
    port,
    state: () => state,
    bind(account: string | null) {
      state = { ...state, account, generation: crypto.randomUUID() };
      for (const listener of listeners) listener(state);
    },
  };
}
function client(
  owner: CacheAuthorityHost,
  fetchProof = vi.fn(async () => `${team}:allowed`),
  retire = vi.fn(async () => {})
) {
  const authority = createCrmAccessAuthority({ fetchProof, retire });
  authority.setSession('viewer');
  authority.setHost(owner);
  return { authority, fetchProof, retire };
}

describe('CRM authority across cache clients', () => {
  it.each([`${team}:allowed`, `${team}:denied`, 'none'])(
    'exposes the current %s proof without fetching optional enrichment',
    async (policy) => {
      const owner = sharedOwner().port();
      const { authority, fetchProof } = client(
        owner,
        vi.fn(async () => policy)
      );
      expect(authority.hasCurrentProof()).toBe(false);
      await authority.prepare();
      expect(authority.hasCurrentProof()).toBe(false);
      expect(fetchProof).not.toHaveBeenCalled();
      await authority.ensureCurrent();
      expect(authority.hasCurrentProof()).toBe(true);
      fetchProof.mockRejectedValueOnce(new Error('offline'));
      await expect(authority.refresh()).rejects.toThrow('offline');
      expect(authority.hasCurrentProof()).toBe(true);
      expect(fetchProof).toHaveBeenCalledTimes(2);
    }
  );
  it.each(['generation', 'account', 'session', 'host'] as const)(
    'does not offer optional cache enrichment after a %s replacement',
    async (replacement) => {
      const storage = sharedOwner();
      const owner = storage.port();
      const { authority, fetchProof } = client(owner);
      await authority.refresh();
      expect(authority.hasCurrentProof()).toBe(true);
      if (replacement === 'generation')
        await owner.transition(storage.state().generation, `${team}:denied`);
      else if (replacement === 'account') storage.bind('another-account');
      else if (replacement === 'session') authority.setSession('viewer', 1);
      else authority.setHost(sharedOwner().port());
      expect(authority.hasCurrentProof()).toBe(false);
      expect(fetchProof).toHaveBeenCalledOnce();
    }
  );
  it.each(['generation', 'session', 'host'] as const)(
    'does not retire a newer %s when an old response loses admission',
    async (replacement) => {
      const { authority, retire } = client(sharedOwner().port());
      await authority.refresh();
      const old = await authority.prepare();
      if (replacement === 'generation') {
        await authority.accept(await authority.prepare(), `${team}:denied`);
        await authority.accept(await authority.prepare(), `${team}:allowed`);
      } else {
        if (replacement === 'session') authority.setSession('viewer', 1);
        else authority.setHost(sharedOwner().port());
        await authority.refresh();
      }
      retire.mockClear();
      await expect(authority.assertCurrent(old)).rejects.toBeInstanceOf(
        StaleCacheAuthorityError
      );
      expect(authority.allowed()).toBe(true);
      expect(retire).not.toHaveBeenCalled();
    }
  );
  it('orders denial and regrant and rejects an older allowed proof from another window', async () => {
    const storage = sharedOwner();
    const a = client(storage.port()).authority;
    const b = client(storage.port()).authority;
    await a.refresh();
    const old = await a.prepare();
    await b.accept(await b.prepare(), `${team}:denied`);
    expect(a.allowed()).toBe(false);
    await expect(a.accept(old, `${team}:allowed`)).rejects.toBeInstanceOf(
      StaleCacheAuthorityError
    );
    expect(storage.state().policy).toBe(`${team}:denied`);
    await b.accept(await b.prepare(), `${team}:allowed`);
    expect(b.allowed()).toBe(true);
  });
  it('reuses a verified proof for offline reads until an explicit revocation signal', async () => {
    const owner = sharedOwner().port();
    const { authority, fetchProof } = client(owner);
    await Promise.all([owner.verifyRead(), owner.verifyRead()]);
    expect(fetchProof).toHaveBeenCalledTimes(1);
    await owner.verifyRead();
    expect(fetchProof).toHaveBeenCalledTimes(1);
    fetchProof.mockRejectedValueOnce(new Error('offline'));
    await expect(owner.verifyRead()).resolves.toBeUndefined();
    expect(fetchProof).toHaveBeenCalledTimes(1);
    fetchProof.mockReset();
    fetchProof.mockResolvedValue(`${team}:denied`);
    await authority.refresh();
    await owner.verifyRead();
    expect(authority.allowed()).toBe(false);
  });
  it('retries a current-state read overtaken by another cache client before fetching proof', async () => {
    const storage = sharedOwner();
    const port = storage.port();
    const observer = createAuthorityObserver(storage.state().identity);
    observer.observe(storage.state());
    const delayed = Promise.withResolvers<CacheAuthority>();
    let reads = 0;
    const owner: CacheAuthorityHost = {
      ...port,
      async current() {
        const version = observer.version();
        const state =
          ++reads === 1 ? await delayed.promise : await port.current();
        return observer.observe(state, version);
      },
      onChanged(callback) {
        return port.onChanged((state) => {
          observer.observe(state);
          callback(state);
        });
      },
    };
    const fetchProof = vi.fn(async () => `${team}:denied`);
    const { authority } = client(owner, fetchProof);
    const old = storage.state();
    const refreshing = authority.refresh();
    await port.transition(old.generation, `${team}:denied`);
    delayed.resolve(old);

    await expect(refreshing).resolves.toMatchObject({
      generation: storage.state().generation,
    });
    expect(fetchProof).toHaveBeenCalledTimes(1);
    expect(authority.allowed()).toBe(false);
    expect(storage.state().ready).toBe(true);
  });
  it.each(['session', 'host'] as const)(
    'does not retry preparation after its %s is replaced',
    async (replacement) => {
      const storage = sharedOwner();
      const delayed = Promise.withResolvers<CacheAuthority>();
      const owner: CacheAuthorityHost = {
        ...storage.port(),
        current: () => delayed.promise,
      };
      const { authority, fetchProof } = client(owner);
      const refreshing = authority.refresh();
      if (replacement === 'session') authority.setSession('another-account');
      else authority.setHost(sharedOwner().port());
      delayed.resolve(storage.state());

      await expect(refreshing).rejects.toBeInstanceOf(StaleCacheAuthorityError);
      expect(fetchProof).not.toHaveBeenCalled();
      expect(authority.allowed()).toBe(false);
    }
  );

  it.each(['initial', 'after binding'] as const)(
    'retries one overtaken %s authority read before preparing a request',
    async (stage) => {
      const storage = sharedOwner(stage === 'initial' ? 'viewer' : null);
      const port = storage.port();
      const observer = createAuthorityObserver(storage.state().identity);
      observer.observe(storage.state());
      const started = Promise.withResolvers<void>();
      const delayed = Promise.withResolvers<CacheAuthority>();
      const heldRead = stage === 'initial' ? 1 : 2;
      let reads = 0;
      const owner: CacheAuthorityHost = {
        ...port,
        current: async () => {
          const version = observer.version();
          const pending = ++reads === heldRead;
          if (pending) started.resolve();
          const state = pending ? await delayed.promise : await port.current();
          return observer.observe(state, version);
        },
        onChanged: (callback) =>
          port.onChanged((state) => {
            observer.observe(state);
            callback(state);
          }),
      };
      const fetchProof = vi.fn(async () => `${team}:allowed`);
      const bindAccount = vi.fn(async () => storage.bind('viewer'));
      const authority = createCrmAccessAuthority({
        fetchProof,
        bindAccount,
        retire: async () => {},
      });
      authority.setSession('viewer');
      authority.setHost(owner);
      const preparing = authority.prepare();
      await started.promise;
      const old = storage.state();
      await port.transition(old.generation, `${team}:allowed`);
      delayed.resolve(old);
      await expect(preparing).resolves.toMatchObject({
        generation: storage.state().generation,
      });
      expect(reads).toBe(heldRead + 1);
      expect(bindAccount).toHaveBeenCalledTimes(stage === 'initial' ? 0 : 1);
      expect(fetchProof).not.toHaveBeenCalled();
    }
  );

  it.each(['session', 'host', 'account', 'account ABA'] as const)(
    'does not recover a stale preparation across %s replacement',
    async (replacement) => {
      const storage = sharedOwner();
      const owner = storage.port();
      const delayed = Promise.withResolvers<CacheAuthority>();
      const current = vi
        .spyOn(owner, 'current')
        .mockReturnValueOnce(delayed.promise);
      const { authority, fetchProof } = client(owner);
      const preparing = authority.prepare();
      const rejected = expect(preparing).rejects.toBeInstanceOf(
        StaleCacheAuthorityError
      );
      if (replacement === 'session') authority.setSession('viewer', 1);
      else if (replacement === 'host') authority.setHost(sharedOwner().port());
      else {
        storage.bind('another-account');
        if (replacement === 'account ABA') storage.bind('viewer');
      }
      delayed.reject(new StaleCacheAuthorityError());
      await rejected;
      expect(current).toHaveBeenCalledOnce();
      expect(fetchProof).not.toHaveBeenCalled();
    }
  );

  it('shares one preparation retry between the initial and post-binding reads', async () => {
    const storage = sharedOwner(null);
    const owner = storage.port();
    const current = vi
      .spyOn(owner, 'current')
      .mockRejectedValueOnce(new StaleCacheAuthorityError())
      .mockResolvedValueOnce(storage.state())
      .mockRejectedValueOnce(new StaleCacheAuthorityError());
    const bindAccount = vi.fn(async () => storage.bind('viewer'));
    const fetchProof = vi.fn(async () => `${team}:allowed`);
    const authority = createCrmAccessAuthority({
      fetchProof,
      bindAccount,
      retire: async () => {},
    });
    authority.setSession('viewer');
    authority.setHost(owner);
    await expect(authority.prepare()).rejects.toBeInstanceOf(
      StaleCacheAuthorityError
    );
    expect(current).toHaveBeenCalledTimes(3);
    expect(bindAccount).toHaveBeenCalledOnce();
    expect(fetchProof).not.toHaveBeenCalled();
  });

  it.each(['login', 'owner account'] as const)(
    'rejects a fresh retry reply after its %s returns to the same account',
    async (replacement) => {
      const storage = sharedOwner();
      const owner = storage.port();
      const started = Promise.withResolvers<void>();
      const delayed = Promise.withResolvers<CacheAuthority>();
      const current = vi
        .spyOn(owner, 'current')
        .mockRejectedValueOnce(new StaleCacheAuthorityError())
        .mockImplementationOnce(() => {
          started.resolve();
          return delayed.promise;
        });
      const { authority, fetchProof } = client(owner);
      const preparing = authority.prepare();
      const rejected = expect(preparing).rejects.toBeInstanceOf(
        StaleCacheAuthorityError
      );
      await started.promise;
      if (replacement === 'login') {
        authority.setSession(undefined);
        authority.setSession('viewer');
      } else {
        storage.bind('another-account');
        storage.bind('viewer');
      }
      delayed.resolve(storage.state());
      await rejected;
      expect(current).toHaveBeenCalledTimes(2);
      expect(fetchProof).not.toHaveBeenCalled();
    }
  );

  it('does not retry a rejected account binding during direct preparation', async () => {
    const owner = sharedOwner(null).port();
    const current = vi.spyOn(owner, 'current');
    const bindAccount = vi
      .fn()
      .mockRejectedValue(new StaleCacheAuthorityError());
    const fetchProof = vi.fn(async () => `${team}:allowed`);
    const authority = createCrmAccessAuthority({
      fetchProof,
      bindAccount,
      retire: async () => {},
    });
    authority.setSession('viewer');
    authority.setHost(owner);
    await expect(authority.prepare()).rejects.toBeInstanceOf(
      StaleCacheAuthorityError
    );
    expect(current).toHaveBeenCalledOnce();
    expect(bindAccount).toHaveBeenCalledOnce();
    expect(fetchProof).not.toHaveBeenCalled();
  });

  it('retains replacement history through the post-binding read after a retry', async () => {
    const storage = sharedOwner(null);
    const owner = storage.port();
    const current = vi
      .spyOn(owner, 'current')
      .mockRejectedValueOnce(new StaleCacheAuthorityError())
      .mockResolvedValueOnce(storage.state())
      .mockImplementationOnce(async () => {
        storage.bind('another-account');
        storage.bind('viewer');
        return storage.state();
      });
    const bindAccount = vi.fn(async () => storage.bind('viewer'));
    const fetchProof = vi.fn(async () => `${team}:allowed`);
    const authority = createCrmAccessAuthority({
      fetchProof,
      bindAccount,
      retire: async () => {},
    });
    authority.setSession('viewer');
    authority.setHost(owner);
    await expect(authority.prepare()).rejects.toBeInstanceOf(
      StaleCacheAuthorityError
    );
    expect(current).toHaveBeenCalledTimes(3);
    expect(bindAccount).toHaveBeenCalledOnce();
    expect(fetchProof).not.toHaveBeenCalled();
  });

  it.each([
    ['prepare', 'stale', 2],
    ['prepare', 'terminal', 1],
    ['refresh', 'stale', 2],
    ['ensureCurrent', 'stale', 4],
  ] as const)(
    'bounds %s %s failures without dispatching a proof',
    async (method, failure, reads) => {
      const owner = sharedOwner().port();
      const error =
        failure === 'terminal'
          ? new Error('storage unavailable')
          : new StaleCacheAuthorityError();
      const current = vi.spyOn(owner, 'current').mockRejectedValue(error);
      const { authority, fetchProof } = client(owner);
      await expect(authority[method]()).rejects.toBe(error);
      // A read guard can exhaust preparation, then the separate proof refresh.
      expect(current).toHaveBeenCalledTimes(reads);
      expect(fetchProof).not.toHaveBeenCalled();
    }
  );
  it('does not confuse the anonymous profile with the account, or reuse a prior login proof', async () => {
    const { authority } = client(sharedOwner().port());
    await authority.refresh();
    const old = await authority.prepare();
    authority.setSession('viewer', 1);
    await expect(
      authority.accept(old, `${team}:allowed`)
    ).rejects.toBeInstanceOf(StaleCacheAuthorityError);
    await authority.refresh();
    const foreign = client(sharedOwner('another-account').port()).authority;
    await expect(foreign.prepare()).rejects.toBeInstanceOf(
      StaleCacheAuthorityError
    );
  });
  it('keeps UI content closed on retirement failure and retries that retirement', async () => {
    const retire = vi.fn(async () => {});
    const { authority } = client(
      sharedOwner().port(),
      vi.fn(async () => `${team}:allowed`),
      retire
    );
    await authority.refresh();
    retire.mockClear();
    retire.mockRejectedValueOnce(new Error('retirement failed'));
    await expect(
      authority.accept(await authority.prepare(), `${team}:denied`)
    ).rejects.toThrow('retirement failed');
    expect(authority.allowed()).toBe(false);
    await authority.refresh();
    expect(authority.allowed()).toBe(true);
    expect(retire).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed login cleanup broad when the next permission proof retries it', async () => {
    const retire = vi.fn(async () => {});
    const { authority } = client(
      sharedOwner().port(),
      vi.fn(async () => `${team}:allowed`),
      retire
    );
    await authority.refresh();
    retire.mockClear();
    retire.mockRejectedValueOnce(new Error('retirement failed'));
    authority.setSession('viewer', 1);
    await expect(authority.ensureCurrent()).rejects.toThrow(
      'retirement failed'
    );
    expect(retire).toHaveBeenLastCalledWith('session');
    await authority.refresh();
    expect(retire).toHaveBeenCalledTimes(2);
    expect(retire).toHaveBeenLastCalledWith('session');
    expect(authority.allowed()).toBe(true);
  });

  it('does not retire a verified replacement owner when an old transition returns', async () => {
    const oldOwner = sharedOwner().port();
    const { authority, retire } = client(oldOwner);
    await authority.refresh();
    const reply = Promise.withResolvers<void>();
    const transitioned = Promise.withResolvers<void>();
    const transition = oldOwner.transition.bind(oldOwner);
    vi.spyOn(oldOwner, 'transition').mockImplementationOnce(async (...args) => {
      const result = await transition(...args);
      transitioned.resolve();
      await reply.promise;
      return result;
    });
    const oldAccept = authority.accept(
      await authority.prepare(),
      `${team}:denied`
    );
    const rejected = expect(oldAccept).rejects.toBeInstanceOf(
      StaleCacheAuthorityError
    );
    await transitioned.promise;
    authority.setHost(sharedOwner().port());
    await authority.refresh();
    retire.mockClear();
    reply.resolve();
    await rejected;
    expect(authority.allowed()).toBe(true);
    expect(retire).not.toHaveBeenCalled();
  });

  it('keeps admission closed until an earlier cleanup settles after a later cleanup fails', async () => {
    const port = sharedOwner().port();
    const { authority, retire } = client(port);
    await authority.refresh();
    const earlier = Promise.withResolvers<void>();
    retire.mockImplementationOnce(() => earlier.promise);
    retire.mockRejectedValueOnce(new Error('later cleanup failed'));
    await port.transition((await port.current()).generation, `${team}:denied`);
    await port.transition((await port.current()).generation, `${team}:allowed`);
    await port.transition((await port.current()).generation, `${team}:denied`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const refreshed = authority.refresh();
    const settled = vi.fn();
    void refreshed.then(settled, settled);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).not.toHaveBeenCalled();
    expect(authority.allowed()).toBe(false);
    earlier.resolve();
    await expect(refreshed).rejects.toThrow('later cleanup failed');
    await authority.refresh();
    expect(authority.allowed()).toBe(true);
  });
});

// Boot and transient network errors must not impersonate a proven denial.
it('ends a failed first proof in a retryable error state instead of loading forever', async () => {
  const fetchProof = vi.fn<() => Promise<string>>(async () => {
    throw new Error('proof unavailable');
  });
  const { authority, retire } = client(sharedOwner().port(), fetchProof);
  await expect(authority.refresh()).rejects.toThrow('proof unavailable');
  expect(authority.state()).toBe('error');
  expect(authority.allowed()).toBe(false);
  expect(retire).not.toHaveBeenCalled();
  fetchProof.mockResolvedValue(`${team}:allowed`);
  const retry = authority.refresh();
  expect(authority.state()).toBe('pending');
  await retry;
  expect(authority.state()).toBe('allowed');
});

it.each([
  new Error('invalid proof'),
  new DOMException('proof timed out', 'TimeoutError'),
])('does not retry a terminal proof error: %s', async (error) => {
  const fetchProof = vi.fn(async () => {
    throw error;
  });
  const { authority } = client(sharedOwner().port(), fetchProof);
  await expect(authority.refresh()).rejects.toBe(error);
  expect(fetchProof).toHaveBeenCalledTimes(1);
});

it('backs off once after a network failure and bounds the second proof timeout', async () => {
  vi.useFakeTimers();
  const fetchProof = vi.fn(async () => `${team}:allowed`);
  fetchProof.mockRejectedValueOnce(new TypeError('offline'));
  const { authority } = client(sharedOwner().port(), fetchProof);
  const refresh = authority.refresh();
  await vi.advanceTimersByTimeAsync(249);
  expect(fetchProof).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await refresh;
  expect(fetchProof.mock.calls).toEqual([[15_000], [3_000]]);
  expect(authority.state()).toBe('allowed');
});

it('shows the retry state after the bounded initial network retry fails', async () => {
  vi.useFakeTimers();
  const fetchProof = vi.fn(async () => {
    throw new TypeError('offline');
  });
  const { authority } = client(sharedOwner().port(), fetchProof);
  const failed = expect(authority.refresh()).rejects.toThrow('offline');
  await vi.advanceTimersByTimeAsync(250);
  await failed;
  expect(authority.state()).toBe('error');
  await vi.runAllTimersAsync();
  expect(fetchProof).toHaveBeenCalledTimes(2);
});

it('keeps boot pending and preserves the last proof across a bounded transient retry', async () => {
  vi.useFakeTimers();
  const proof = Promise.withResolvers<string>();
  const fetchProof = vi.fn(() => proof.promise);
  const { authority, retire } = client(sharedOwner().port(), fetchProof);
  expect(authority.state()).toBe('pending');
  const boot = authority.refresh();
  expect(authority.state()).toBe('pending');
  proof.resolve(`${team}:allowed`);
  await boot;
  expect(authority.state()).toBe('allowed');
  expect(retire).not.toHaveBeenCalled();
  fetchProof.mockRejectedValue(new TypeError('offline'));
  const failedRefresh = expect(authority.refresh()).rejects.toThrow('offline');
  await vi.advanceTimersByTimeAsync(250);
  await failedRefresh;
  expect(fetchProof).toHaveBeenCalledTimes(3);
  expect(authority.state()).toBe('allowed');
  expect(retire).not.toHaveBeenCalled();
  await expect(authority.ensureCurrent()).resolves.toBeDefined();
  expect(fetchProof).toHaveBeenCalledTimes(3);
  fetchProof.mockResolvedValue(`${team}:denied`);
  await authority.refresh();
  expect(authority.state()).toBe('denied');
  expect(retire).toHaveBeenCalledTimes(1);
  fetchProof.mockRejectedValue(new TypeError('offline'));
  const failedDeniedRefresh = expect(authority.refresh()).rejects.toThrow(
    'offline'
  );
  await vi.advanceTimersByTimeAsync(250);
  await failedDeniedRefresh;
  expect(authority.state()).toBe('denied');
});

it('does not retire persisted queries while binding a fresh owner for the first proof', async () => {
  const { authority, retire } = client(sharedOwner(null).port());
  await authority.refresh();
  expect(authority.state()).toBe('allowed');
  expect(retire).not.toHaveBeenCalled();
});

it.each(['none', '00000000-0000-4000-8000-000000000002:allowed'])(
  'retires the previous team scope when the same account changes to %s',
  async (policy) => {
    const { authority, retire, fetchProof } = client(sharedOwner().port());
    await authority.refresh();
    fetchProof.mockResolvedValue(policy);
    await authority.refresh();
    expect(retire).toHaveBeenCalledTimes(1);
    expect(authority.state()).toBe(policy === 'none' ? 'denied' : 'allowed');
  }
);

it('rejects an old owner lookup before it can deny or retire the replacement session', async () => {
  const oldOwner = sharedOwner().port();
  const { authority, retire } = client(oldOwner);
  const old = await authority.refresh();
  const previous = await oldOwner.current();
  const reply = Promise.withResolvers<CacheAuthority>();
  vi.spyOn(oldOwner, 'snapshot').mockReturnValue(undefined);
  vi.spyOn(oldOwner, 'current').mockReturnValue(reply.promise);
  const assertion = authority.assertCurrent(old);
  const rejected = expect(assertion).rejects.toBeInstanceOf(
    StaleCacheAuthorityError
  );
  authority.setHost(sharedOwner().port());
  await authority.refresh();
  retire.mockClear();
  reply.resolve({ ...previous, policy: `${team}:denied` });
  await rejected;
  expect(authority.state()).toBe('allowed');
  expect(retire).not.toHaveBeenCalled();
});
