import type {
  CacheAuthority,
  CacheAuthorityHost,
} from '@graphql-cache/authority';
import {
  createAuthorityObserver,
  StaleCacheAuthorityError,
} from '@graphql-cache/authority';
import { describe, expect, it, vi } from 'vitest';
import { createCrmAccessAuthority } from './crm-access-authority';

const team = '00000000-0000-4000-8000-000000000001';
function sharedOwner(account = 'viewer') {
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
  return { port, state: () => state };
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
      authority.retireUnverified(old);
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
  it('obtains a new primary proof on every protected read, coalescing only in-flight work', async () => {
    const owner = sharedOwner().port();
    const { authority, fetchProof } = client(owner);
    await Promise.all([owner.verifyRead(), owner.verifyRead()]);
    expect(fetchProof).toHaveBeenCalledTimes(1);
    await owner.verifyRead();
    expect(fetchProof).toHaveBeenCalledTimes(2);
    fetchProof.mockResolvedValue(`${team}:denied`);
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
});
