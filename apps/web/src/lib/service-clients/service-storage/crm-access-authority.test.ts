import type {
  CacheAuthority,
  CacheAuthorityHost,
} from '@graphql-cache/authority';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
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
