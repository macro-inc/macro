import type {
  CacheAuthority,
  CacheAuthorityHost,
} from '@graphql-cache/authority';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { afterEach, expect, it, vi } from 'vitest';
import { createCrmAccessAuthority } from './crm-access-authority';

const team = '00000000-0000-4000-8000-000000000001';
afterEach(() => vi.useRealTimers());
function sharedOwner(policy: string | null = null) {
  let state: CacheAuthority = {
    identity: 'profile',
    account: 'viewer',
    generation: crypto.randomUUID(),
    policy,
    ready: policy !== null,
  };
  const listeners = new Set<(state: CacheAuthority) => void>();
  const owner: CacheAuthorityHost = {
    current: async () => state,
    snapshot: () => state,
    onChanged(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    async transition(expected, next) {
      if (expected !== state.generation) throw new StaleCacheAuthorityError();
      const changed = state.policy !== next;
      const newGeneration =
        (state.policy !== null && changed) ||
        (next.endsWith(':denied') && changed);
      state = {
        ...state,
        generation: newGeneration ? crypto.randomUUID() : state.generation,
        policy: next,
        ready: true,
      };
      for (const listener of listeners) listener(state);
      return { authority: state, revision: '0', affectedOps: [], changed };
    },
  };
  return owner;
}
function client(
  owner = sharedOwner(),
  fetchProof = vi.fn<(timeoutMs: number) => Promise<string>>(
    async () => `${team}:allowed`
  )
) {
  const retire = vi.fn(async () => {});
  const authority = createCrmAccessAuthority({ fetchProof, retire });
  authority.setHost(owner);
  authority.setSession('viewer');
  return { authority, fetchProof, retire };
}

it.each([`${team}:allowed`, 'none'])(
  'preserves the initial generation and offline snapshots for %s',
  async (policy) => {
    const owner = sharedOwner();
    const before = await owner.current();
    const { authority, retire } = client(
      owner,
      vi.fn(async () => policy)
    );
    await authority.refresh();
    expect(authority.snapshot()?.generation).toBe(before.generation);
    expect(retire).not.toHaveBeenCalled();
    expect(authority.state()).toBe(policy === 'none' ? 'denied' : 'allowed');
  }
);

it('keeps an unchanged durable boot and focus proof out of retirement', async () => {
  const owner = sharedOwner(`${team}:allowed`);
  const before = await owner.current();
  const { authority, retire, fetchProof } = client(owner);
  await authority.refresh();
  await authority.refresh();
  expect(fetchProof).toHaveBeenCalledTimes(2);
  expect(authority.snapshot()?.generation).toBe(before.generation);
  expect(retire).not.toHaveBeenCalled();
});

it('initializes only the local owner before login without requesting proof', async () => {
  const owner = sharedOwner(`${team}:allowed`);
  const initialize = vi.fn();
  const fetchProof = vi.fn(async () => `${team}:allowed`);
  const retire = vi.fn(async () => {});
  const authority = createCrmAccessAuthority({
    initialize,
    fetchProof,
    retire,
  });
  authority.setHost(owner);
  await authority.initialize();
  expect(initialize).toHaveBeenCalledExactlyOnceWith(
    owner.snapshot()!.generation
  );
  expect(fetchProof).not.toHaveBeenCalled();
  authority.setSession('viewer');
  await authority.refresh();
  expect(retire).not.toHaveBeenCalled();
  expect(initialize).toHaveBeenCalledOnce();
  authority.setSession('viewer', 1);
  await authority.refresh();
  expect(retire).not.toHaveBeenCalled();
  expect(authority.state()).toBe('allowed');
});

it('fences a restored owner belonging to another account on first login', async () => {
  const owner = sharedOwner(`${team}:allowed`);
  const fetchProof = vi.fn(async () => `${team}:allowed`);
  const retire = vi.fn(async () => {});
  const authority = createCrmAccessAuthority({ fetchProof, retire });
  authority.setHost(owner);
  await authority.initialize();
  authority.setSession('replacement');
  expect(retire).toHaveBeenCalledWith('session', expect.any(String));
  const fence = retire.mock.calls.at(-1);
  await authority.initialize();
  expect(retire).toHaveBeenCalledOnce();
  expect(retire.mock.calls.at(-1)).toBe(fence);
  expect(authority.state()).toBe('pending');
});

it('preserves the memory-only startup generation through first login', async () => {
  const initialize = vi.fn();
  const fetchProof = vi.fn(async () => `${team}:allowed`);
  const retire = vi.fn(async () => {});
  const authority = createCrmAccessAuthority({
    initialize,
    fetchProof,
    retire,
  });
  await authority.initialize();
  const before = authority.snapshot()!.generation;
  authority.setSession('viewer');
  await authority.refresh();
  expect(authority.snapshot()!.generation).toBe(before);
  expect(retire).not.toHaveBeenCalled();
  expect(initialize).toHaveBeenCalledExactlyOnceWith(before);
  authority.setSession('replacement');
  await authority.refresh();
  expect(authority.snapshot()!.generation).not.toBe(before);
  expect(retire).toHaveBeenCalledWith('session', expect.any(String));
});

it('does not restore an old account generation after delayed local initialization', async () => {
  const owner = sharedOwner(`${team}:allowed`);
  const { authority, retire } = client(owner);
  await authority.refresh();
  const old = owner.snapshot()!;
  const current = Promise.withResolvers<CacheAuthority>();
  vi.spyOn(owner, 'current').mockReturnValueOnce(current.promise);
  const initializing = authority.initialize();
  authority.setSession('replacement');
  retire.mockClear();
  current.resolve(old);
  await initializing;
  expect(retire).not.toHaveBeenCalled();
  expect(authority.state()).toBe('pending');
  const replacement = authority.initialize();
  expect(replacement).not.toBe(initializing);
  await replacement;
  expect(retire).not.toHaveBeenCalled();
});

it('keeps the account fence when the previous first proof completes late', async () => {
  const owner = sharedOwner();
  const transition = owner.transition;
  const sent = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  vi.spyOn(owner, 'transition').mockImplementationOnce(
    async (expected, policy) => {
      sent.resolve();
      await finish.promise;
      return transition(expected, policy);
    }
  );
  const { authority, retire } = client(owner);
  const refreshing = authority.refresh();
  await sent.promise;
  authority.setSession('replacement');
  retire.mockClear();
  finish.resolve();
  await refreshing;
  expect(authority.state()).toBe('pending');
  expect(retire).not.toHaveBeenCalled();
});

it('coalesces boot refreshes without making ordinary reads depend on a proof', async () => {
  const proof = Promise.withResolvers<string>();
  const fetchProof = vi.fn(() => proof.promise);
  const owner = sharedOwner();
  const { authority } = client(owner, fetchProof);
  const first = authority.refresh();
  const second = authority.refresh();
  expect(first).toBe(second);
  expect(authority.state()).toBe('pending');
  await expect(owner.current()).resolves.toMatchObject({ ready: false });
  proof.resolve(`${team}:allowed`);
  await first;
  expect(fetchProof).toHaveBeenCalledOnce();
  expect(authority.state()).toBe('allowed');
});

it('observes denial and regrant in every window without a per-window proof', async () => {
  const owner = sharedOwner(`${team}:allowed`);
  const first = client(owner);
  const second = client(owner);
  await Promise.all([first.authority.refresh(), second.authority.refresh()]);
  first.retire.mockClear();
  second.retire.mockClear();
  first.fetchProof.mockResolvedValue(`${team}:denied`);
  await first.authority.refresh();
  expect(first.authority.state()).toBe('denied');
  expect(second.authority.state()).toBe('denied');
  expect(second.fetchProof).toHaveBeenCalledOnce();
  expect(first.retire).toHaveBeenCalledWith(
    'permission',
    owner.snapshot()?.generation
  );
  expect(second.retire).toHaveBeenCalledWith(
    'permission',
    owner.snapshot()?.generation
  );
  first.fetchProof.mockResolvedValue(`${team}:allowed`);
  await first.authority.refresh();
  expect(second.authority.state()).toBe('allowed');
});

it('never reapplies an allowed response whose generation was retired by another window', async () => {
  const owner = sharedOwner(`${team}:allowed`);
  const proof = Promise.withResolvers<string>();
  const started = Promise.withResolvers<void>();
  const fetchProof = vi
    .fn<(timeoutMs: number) => Promise<string>>()
    .mockImplementationOnce(() => {
      started.resolve();
      return proof.promise;
    })
    .mockResolvedValue(`${team}:denied`);
  const { authority } = client(owner, fetchProof);
  const refreshing = authority.refresh();
  await started.promise;
  await owner.transition(owner.snapshot()!.generation, `${team}:denied`);
  proof.resolve(`${team}:allowed`);
  await refreshing;
  expect(authority.state()).toBe('denied');
  expect(fetchProof).toHaveBeenCalledTimes(2);
});

it.each([
  new Error('invalid proof'),
  new DOMException('proof timed out', 'TimeoutError'),
])(
  'ends an initial terminal failure in the retry state without a second timeout: %s',
  async (error) => {
    const fetchProof = vi.fn<(timeoutMs: number) => Promise<string>>(
      async () => {
        throw error;
      }
    );
    const { authority } = client(sharedOwner(), fetchProof);
    await expect(authority.refresh()).rejects.toBe(error);
    expect(authority.state()).toBe('error');
    expect(fetchProof).toHaveBeenCalledOnce();
    fetchProof.mockResolvedValue(`${team}:allowed`);
    const retry = authority.refresh();
    expect(authority.state()).toBe('pending');
    await retry;
    expect(authority.state()).toBe('allowed');
  }
);

it('bounds network retry to one backoff and a short second timeout', async () => {
  vi.useFakeTimers();
  const fetchProof = vi
    .fn(async (_timeoutMs: number) => `${team}:allowed`)
    .mockRejectedValueOnce(new TypeError('offline'));
  const { authority } = client(sharedOwner(), fetchProof);
  const refresh = authority.refresh();
  await vi.advanceTimersByTimeAsync(249);
  expect(fetchProof).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await refresh;
  expect(fetchProof.mock.calls).toEqual([[15_000], [3_000]]);
});

it.each([null, `${team}:allowed`, `${team}:denied`])(
  'retains the last proven state through a bounded network failure: %s',
  async (policy) => {
    vi.useFakeTimers();
    const fetchProof = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const { authority } = client(sharedOwner(policy), fetchProof);
    const failure = expect(authority.refresh()).rejects.toThrow('offline');
    await vi.advanceTimersByTimeAsync(250);
    await failure;
    expect(authority.state()).toBe(
      policy === null
        ? 'error'
        : policy.endsWith(':denied')
          ? 'denied'
          : 'allowed'
    );
    await vi.runAllTimersAsync();
    expect(fetchProof).toHaveBeenCalledTimes(2);
  }
);

it.each(['none', '00000000-0000-4000-8000-000000000002:allowed'])(
  'retires snapshots of the previous team before accepting %s',
  async (policy) => {
    const { authority, retire, fetchProof } = client(
      sharedOwner(`${team}:allowed`)
    );
    await authority.refresh();
    retire.mockClear();
    fetchProof.mockResolvedValue(policy);
    await authority.refresh();
    expect(retire).toHaveBeenCalledWith(
      'permission',
      authority.snapshot()?.generation
    );
  }
);

it('ignores a late proof after replacing the login', async () => {
  const proof = Promise.withResolvers<string>();
  const started = Promise.withResolvers<void>();
  const { authority, retire } = client(
    sharedOwner(),
    vi.fn(() => {
      started.resolve();
      return proof.promise;
    })
  );
  const old = authority.refresh();
  await started.promise;
  authority.setSession('replacement');
  retire.mockClear();
  proof.resolve(`${team}:denied`);
  await old;
  expect(authority.state()).toBe('pending');
  expect(retire).not.toHaveBeenCalled();
});

it('retries an interrupted visible-cache cleanup even when the durable generation is unchanged', async () => {
  const { authority, retire, fetchProof } = client(
    sharedOwner(`${team}:allowed`)
  );
  await authority.refresh();
  retire.mockClear();
  retire.mockRejectedValueOnce(new Error('disk flush failed'));
  fetchProof.mockResolvedValue(`${team}:denied`);
  await expect(authority.refresh()).rejects.toThrow('disk flush failed');
  expect(authority.state()).toBe('denied');
  const generation = authority.snapshot()?.generation;
  await authority.refresh();
  expect(retire.mock.calls).toEqual([
    ['permission', generation],
    ['permission', generation],
  ]);
});

it('retains failed session cleanup across the next owner observation', async () => {
  const { authority, retire } = client(sharedOwner(`${team}:allowed`));
  await authority.refresh();
  retire.mockClear();
  retire.mockRejectedValueOnce(new Error('session prune failed'));
  authority.setSession(undefined, 1);
  authority.setHost(sharedOwner(`${team}:allowed`));
  authority.setSession('viewer', 2);
  await authority.refresh();
  expect(retire).toHaveBeenCalledTimes(2);
  expect(retire).toHaveBeenNthCalledWith(1, 'session', expect.any(String));
  expect(retire).toHaveBeenNthCalledWith(2, 'session', expect.any(String));
});
