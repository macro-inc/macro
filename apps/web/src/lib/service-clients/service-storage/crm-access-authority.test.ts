import type {
  CacheAuthority,
  CacheAuthorityHost,
} from '@graphql-cache/authority';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { createComputed, createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  configureCrmAccessAuthority,
  createCrmAccessAuthority,
  crmAccessAllowed,
  crmAccessAuthority,
  crmAccessState,
} from './crm-access-authority';

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

it('keeps entry points through a pending and a failed proof and closes them on a proven denial', async () => {
  vi.useFakeTimers();
  const fetchProof = vi.fn(async (_timeoutMs: number): Promise<string> => {
    throw new TypeError('offline');
  });
  configureCrmAccessAuthority({ fetchProof, retire: async () => {} });
  crmAccessAuthority.setHost(sharedOwner());
  crmAccessAuthority.setSession('viewer');
  try {
    expect(crmAccessState()).toBe('pending');
    expect(crmAccessAllowed()).toBe(true);
    const failure = expect(crmAccessAuthority.refresh()).rejects.toThrow(
      'offline'
    );
    await vi.advanceTimersByTimeAsync(250);
    await failure;
    expect(crmAccessState()).toBe('error');
    expect(crmAccessAllowed()).toBe(true);
    fetchProof.mockResolvedValue(`${team}:denied`);
    await crmAccessAuthority.refresh();
    expect(crmAccessState()).toBe('denied');
    expect(crmAccessAllowed()).toBe(false);
  } finally {
    crmAccessAuthority.setSession(undefined);
    crmAccessAuthority.setHost(undefined);
  }
});

it('keeps team-less users admitted to the existing join-a-team workspace', async () => {
  const { authority } = client(
    sharedOwner('none'),
    vi.fn(async () => 'none')
  );
  await authority.refresh();
  expect(authority.state()).toBe('allowed');
  expect(authority.allowed()).toBe(true);
});

it('keeps a proven denial through a failed local commit and failed proof until a confirmed grant', async () => {
  const owner = sharedOwner(`${team}:allowed`);
  const { authority, fetchProof } = client(owner);
  await authority.refresh();
  fetchProof.mockResolvedValue(`${team}:denied`);
  const commit = vi
    .spyOn(owner, 'transition')
    .mockRejectedValueOnce(new Error('disk failure'));
  await expect(authority.refresh()).rejects.toThrow('disk failure');
  expect(authority.state()).toBe('denied');
  expect(owner.snapshot()?.policy).toBe(`${team}:allowed`);
  fetchProof.mockRejectedValueOnce(new Error('proof unavailable'));
  await expect(authority.refresh()).rejects.toThrow('proof unavailable');
  expect(authority.state()).toBe('denied');
  commit.mockRestore();
  fetchProof.mockResolvedValue(`${team}:allowed`);
  await authority.refresh();
  expect(authority.state()).toBe('allowed');
});

it('retires its own copies once when a proven denial cannot be committed', async () => {
  const owner = sharedOwner(`${team}:allowed`);
  const { authority, fetchProof, retire } = client(owner);
  await authority.refresh();
  retire.mockClear();
  fetchProof.mockResolvedValue(`${team}:denied`);
  vi.spyOn(owner, 'transition').mockRejectedValue(new Error('disk failure'));
  await expect(authority.refresh()).rejects.toThrow('disk failure');
  expect(retire).toHaveBeenCalledExactlyOnceWith(
    'permission',
    owner.snapshot()?.generation
  );
  await expect(authority.refresh()).rejects.toThrow('disk failure');
  expect(retire).toHaveBeenCalledOnce();
  expect(authority.state()).toBe('denied');
});

it('keeps a proven denial when its owner is replaced by one that still records access', async () => {
  const { authority, fetchProof } = client(sharedOwner(`${team}:allowed`));
  await authority.refresh();
  fetchProof.mockResolvedValue(`${team}:denied`);
  await authority.refresh();
  expect(authority.state()).toBe('denied');
  const requested = Promise.withResolvers<void>();
  const proof = Promise.withResolvers<string>();
  fetchProof.mockImplementation(async () => {
    requested.resolve();
    return proof.promise;
  });
  authority.setHost(sharedOwner(`${team}:allowed`));
  await requested.promise;
  expect(authority.state()).toBe('denied');
  proof.resolve(`${team}:allowed`);
  await authority.refresh();
  expect(authority.state()).toBe('allowed');
});

it('keeps its generation while its host is paused, and when it serves again', async () => {
  const owner = sharedOwner(`${team}:allowed`);
  const { authority, retire } = client(owner);
  await authority.refresh();
  retire.mockClear();
  const generation = authority.snapshot()?.generation;

  authority.setHost(undefined, generation);
  await authority.refresh();
  expect(authority.state()).toBe('allowed');
  expect(authority.snapshot()?.generation).toBe(generation);

  authority.setHost(owner);
  await authority.refresh();
  expect(authority.state()).toBe('allowed');
  expect(authority.snapshot()?.generation).toBe(generation);
  expect(retire).not.toHaveBeenCalled();
});

it('follows a regrant committed by another window after proving the denial itself', async () => {
  const owner = sharedOwner(`${team}:allowed`);
  const first = client(owner);
  const second = client(owner);
  await Promise.all([first.authority.refresh(), second.authority.refresh()]);
  first.fetchProof.mockResolvedValue(`${team}:denied`);
  await first.authority.refresh();
  expect(first.authority.state()).toBe('denied');
  second.fetchProof.mockResolvedValue(`${team}:allowed`);
  await second.authority.refresh();
  expect(second.authority.state()).toBe('allowed');
  expect(first.authority.state()).toBe('allowed');
});

it.each([null, `${team}:denied`, `${team}:allowed`])(
  'uses an early proof only for UI and commits the later proof after the %s baseline',
  async (policy) => {
    const owner = sharedOwner(policy);
    const baseline = owner.snapshot()!;
    const local = Promise.withResolvers<CacheAuthority>();
    const postBaseline = Promise.withResolvers<string>();
    const postStarted = Promise.withResolvers<void>();
    vi.spyOn(owner, 'snapshot').mockReturnValue(undefined);
    vi.spyOn(owner, 'current').mockReturnValue(local.promise);
    const commit = vi.spyOn(owner, 'transition');
    const fetchProof = vi
      .fn<(timeout: number) => Promise<string>>()
      .mockResolvedValueOnce(`${team}:allowed`)
      .mockImplementationOnce(() => {
        postStarted.resolve();
        return postBaseline.promise;
      });
    const authority = createCrmAccessAuthority({
      earlyProof: true,
      fetchProof,
      retire: async () => {},
    });
    authority.setHost(owner);
    authority.setSession('viewer');
    const opened = Promise.withResolvers<void>();
    const dispose = createRoot((dispose) => {
      createComputed(() => {
        if (authority.allowed()) opened.resolve();
      });
      return dispose;
    });
    try {
      const refresh = authority.refresh();
      await opened.promise;
      expect(fetchProof.mock.calls).toEqual([[3_000]]);
      expect(commit).not.toHaveBeenCalled();
      local.resolve(baseline);
      await postStarted.promise;
      expect(authority.state()).toBe(
        policy?.endsWith(':denied') ? 'denied' : 'allowed'
      );
      expect(commit).not.toHaveBeenCalled();
      expect(fetchProof.mock.calls).toEqual([[3_000], [15_000]]);
      postBaseline.resolve(`${team}:denied`);
      await refresh;
      expect(commit).toHaveBeenCalledExactlyOnceWith(
        baseline.generation,
        `${team}:denied`
      );
      expect(authority.state()).toBe('denied');
    } finally {
      dispose();
    }
  }
);

it.each(['login', 'host', 'mismatching-owner'])(
  'ignores an early allowed proof after a %s change',
  async (change) => {
    const owner = sharedOwner(`${team}:denied`);
    const baseline = owner.snapshot()!;
    const local = Promise.withResolvers<CacheAuthority>();
    const early = Promise.withResolvers<string>();
    const sent = Promise.withResolvers<void>();
    const postStarted = Promise.withResolvers<void>();
    const postBaseline = Promise.withResolvers<string>();
    vi.spyOn(owner, 'snapshot').mockReturnValue(undefined);
    vi.spyOn(owner, 'current').mockReturnValue(local.promise);
    const authority = createCrmAccessAuthority({
      earlyProof: true,
      retire: async () => {},
      fetchProof: vi
        .fn<() => Promise<string>>()
        .mockImplementationOnce(() => {
          sent.resolve();
          return early.promise;
        })
        .mockImplementation(() => {
          postStarted.resolve();
          return postBaseline.promise;
        }),
    });
    authority.setHost(owner);
    authority.setSession('viewer');
    const states: string[] = [];
    const dispose = createRoot((dispose) => {
      createComputed(() => {
        states.push(authority.state());
      });
      return dispose;
    });
    try {
      const refresh = authority.refresh();
      await sent.promise;
      if (change === 'login') authority.setSession('replacement');
      if (change === 'host') authority.setHost(sharedOwner(`${team}:denied`));
      local.resolve(
        change === 'mismatching-owner'
          ? { ...baseline, account: 'previous-viewer' }
          : baseline
      );
      if (change !== 'login') await postStarted.promise;
      early.resolve(`${team}:allowed`);
      postBaseline.resolve(`${team}:denied`);
      await refresh;
      if (change === 'host') await authority.refresh();
      expect(states).not.toContain('allowed');
    } finally {
      dispose();
    }
  }
);

it('keeps native startup pending until the owner is known', async () => {
  const owner = sharedOwner(`${team}:allowed`);
  const baseline = owner.snapshot()!;
  const local = Promise.withResolvers<CacheAuthority>();
  vi.spyOn(owner, 'snapshot').mockReturnValue(undefined);
  vi.spyOn(owner, 'current').mockReturnValue(local.promise);
  const fetchProof = vi.fn(async () => `${team}:allowed`);
  const authority = createCrmAccessAuthority({
    earlyProof: false,
    fetchProof,
    retire: async () => {},
  });
  authority.setHost(owner);
  authority.setSession('viewer');
  const refresh = authority.refresh();
  expect(authority.allowed()).toBe(false);
  expect(fetchProof).not.toHaveBeenCalled();
  local.resolve(baseline);
  await refresh;
  expect(fetchProof).toHaveBeenCalledExactlyOnceWith(15_000);
});

it.each(['denied-response', 'unfinished-owner'])(
  'does not open cached CRM after an early %s',
  async (mode) => {
    const owner = sharedOwner(`${team}:allowed`);
    const baseline = {
      ...owner.snapshot()!,
      ready: mode !== 'unfinished-owner',
    };
    const local = Promise.withResolvers<CacheAuthority>();
    const postStarted = Promise.withResolvers<void>();
    const postBaseline = Promise.withResolvers<string>();
    vi.spyOn(owner, 'snapshot').mockReturnValue(undefined);
    vi.spyOn(owner, 'current').mockReturnValue(local.promise);
    const authority = createCrmAccessAuthority({
      earlyProof: true,
      retire: async () => {},
      fetchProof: vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce(
          `${team}:${mode === 'denied-response' ? 'denied' : 'allowed'}`
        )
        .mockImplementationOnce(() => {
          postStarted.resolve();
          return postBaseline.promise;
        }),
    });
    authority.setHost(owner);
    authority.setSession('viewer');
    const early = Promise.withResolvers<void>();
    const dispose = createRoot((dispose) => {
      createComputed(() => {
        if (authority.state() !== 'pending') early.resolve();
      });
      return dispose;
    });
    try {
      const refresh = authority.refresh();
      await early.promise;
      local.resolve(baseline);
      await postStarted.promise;
      expect(authority.allowed()).toBe(false);
      postBaseline.resolve(`${team}:allowed`);
      await refresh;
      expect(authority.allowed()).toBe(true);
    } finally {
      dispose();
    }
  }
);

it('opens CRM from a matching allowed startup hint without waiting for the store or proof', async () => {
  const owner = sharedOwner(`${team}:allowed`);
  const local = Promise.withResolvers<CacheAuthority>();
  const previous = owner.snapshot()!;
  vi.spyOn(owner, 'current').mockReturnValue(local.promise);
  const retire = vi.fn(async () => {});
  const fetchProof = vi.fn(async () => `${team}:allowed`);
  const authority = createCrmAccessAuthority({
    hint: previous,
    retire,
    fetchProof,
  });
  authority.setHost(owner);
  authority.setSession('viewer');
  expect(authority.state()).toBe('allowed');
  const initializing = authority.initialize();
  expect(authority.allowed()).toBe(true);
  expect(fetchProof).not.toHaveBeenCalled();
  local.resolve({
    ...previous,
    policy: `${team}:denied`,
    generation: crypto.randomUUID(),
  });
  await initializing;
  expect(authority.state()).toBe('denied');
  expect(retire).toHaveBeenCalledWith('permission', expect.any(String));
});

it.each([null, `${team}:allowed`])(
  'replaces a ready allowed hint with a pending unfinished owner (%s)',
  async (policy) => {
    const hint = sharedOwner(`${team}:allowed`).snapshot()!;
    const owner = sharedOwner();
    vi.spyOn(owner, 'current').mockResolvedValue({
      ...hint,
      policy,
      ready: false,
    });
    const authority = createCrmAccessAuthority({
      hint,
      retire: async () => {},
      fetchProof: async () => `${team}:allowed`,
    });
    authority.setHost(owner);
    authority.setSession('viewer');
    expect(authority.allowed()).toBe(true);
    await authority.initialize();
    expect(authority.state()).toBe('pending');
  }
);

it.each(['missing', 'denied', 'different-account', 'unfinished'])(
  'keeps the %s startup hint closed until an owner or proof confirms access',
  (mode) => {
    const hint = sharedOwner(`${team}:allowed`).snapshot()!;
    const authority = createCrmAccessAuthority({
      hint:
        mode === 'missing'
          ? undefined
          : {
              ...hint,
              account:
                mode === 'different-account' ? 'previous-viewer' : hint.account,
              policy: mode === 'denied' ? `${team}:denied` : hint.policy,
              ready: mode !== 'unfinished',
            },
      retire: async () => {},
      fetchProof: async () => `${team}:allowed`,
    });
    authority.setSession('viewer');
    expect(authority.state()).toBe(mode === 'denied' ? 'denied' : 'pending');
  }
);

it('does not restore the allowed hint after login has already observed a denial', async () => {
  const hint = sharedOwner(`${team}:allowed`).snapshot()!;
  const authority = createCrmAccessAuthority({
    hint,
    retire: async () => {},
    fetchProof: async () => `${team}:allowed`,
  });
  authority.setHost(sharedOwner(`${team}:denied`));
  await authority.initialize();
  authority.setSession('viewer');
  expect(authority.allowed()).toBe(false);
});

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
    expect(authority.state()).toBe('allowed');
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

it.each([false, true])(
  'fences a late first owner before binding the login account (owner emits: %s)',
  async (emits) => {
    const previous: CacheAuthority = {
      identity: 'profile',
      account: 'previous-viewer',
      generation: crypto.randomUUID(),
      policy: `${team}:allowed`,
      ready: true,
    };
    let current = previous;
    const read = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const listeners = new Set<(next: CacheAuthority) => void>();
    const owner: CacheAuthorityHost = {
      snapshot: () => undefined,
      async current() {
        started.resolve();
        await read.promise;
        if (emits) for (const listener of listeners) listener(current);
        return current;
      },
      onChanged(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      async transition(expected, policy) {
        expect(expected).toBe(current.generation);
        current = { ...current, policy, ready: true };
        return {
          authority: current,
          changed: false,
          revision: '0',
          affectedOps: [],
        };
      },
    };
    const initialize = vi.fn();
    const retire = vi.fn(async (_scope: unknown, _generation: string) => {});
    const bindAccount = vi.fn(async () => {
      expect(retire).toHaveBeenCalledExactlyOnceWith(
        'session',
        expect.any(String)
      );
      expect(initialize).not.toHaveBeenCalled();
      current = {
        ...current,
        account: 'viewer',
        generation: crypto.randomUUID(),
      };
    });
    const authority = createCrmAccessAuthority({
      initialize,
      retire,
      bindAccount,
      fetchProof: async () => `${team}:allowed`,
    });
    authority.setHost(owner);
    authority.setSession('viewer');
    const refreshing = authority.refresh();
    await started.promise;
    expect(retire).not.toHaveBeenCalled();
    read.resolve();
    await refreshing;
    expect(bindAccount).toHaveBeenCalledOnce();
    expect(initialize).not.toHaveBeenCalled();
    expect(authority.snapshot()?.account).toBe('viewer');
    expect(authority.state()).toBe('allowed');
    expect(
      retire.mock.calls.every(
        ([, generation]) => generation !== previous.generation
      )
    ).toBe(true);
  }
);

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
  const states: string[] = [];
  const dispose = createRoot((dispose) => {
    createComputed(() => states.push(authority.state()));
    return dispose;
  });
  proof.resolve(`${team}:allowed`);
  await refreshing;
  dispose();
  expect(states).not.toContain('allowed');
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
