import { guardResponseBody } from '@core/util/response-observers';
import { createCrmAccessAuthority } from '@service-storage/crm-access-authority';
import { expect, it, vi } from 'vitest';
import {
  type CacheAuthority,
  type CacheAuthorityHost,
  StaleCacheAuthorityError,
} from './authority';
import { initialCacheRetirement } from './generation-mirror';
import { createSessionGeneration } from './session-generation';

const hint: CacheAuthority = {
  identity: 'profile',
  account: 'viewer',
  generation: '00000000-0000-4000-8000-000000000001',
  policy: '00000000-0000-4000-8000-000000000002:allowed',
  ready: true,
};

function startup(mirror: CacheAuthority | undefined, current: CacheAuthority) {
  const generation = createSessionGeneration(mirror?.generation);
  const cleanup = vi.fn(async () => {});
  const retire = vi.fn((_scope: unknown, next: string) =>
    generation.transition(cleanup, next)
  );
  const fetchProof = vi.fn(async () => {
    throw new Error('Startup must not await a permission proof');
  });
  const owner: CacheAuthorityHost = {
    current: async () => current,
    snapshot: () => current,
    onChanged: () => () => {},
    transition: vi.fn(),
  };
  const initialize = vi.fn((next: string) => generation.initialize(next));
  const authority = createCrmAccessAuthority({
    initialize,
    restore: (next) => initialCacheRetirement(mirror, next),
    retire,
    fetchProof,
  });
  authority.setHost(owner);
  authority.setSession('viewer');
  const captured = generation.capture();
  const guard = (response: Response) =>
    guardResponseBody(response, () => {
      if (!generation.isCurrent(captured)) throw new StaleCacheAuthorityError();
    });
  return {
    authority,
    generation,
    cleanup,
    retire,
    fetchProof,
    initialize,
    captured,
    guard,
  };
}

it('decodes REST, PDF and image bodies across a same-access stale hint without retirement', async () => {
  const current = { ...hint, generation: crypto.randomUUID() };
  const state = startup(hint, current);
  const changed = vi.fn();
  state.generation.onChanged(changed);
  const json = state.guard(Response.json({ subject: 'Personal mail' }));
  const pdf = state.guard(
    new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } })
  );
  const image = state.guard(
    new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { 'Content-Type': 'image/png' },
    })
  );
  await state.authority.initialize();
  await expect(json.json()).resolves.toEqual({ subject: 'Personal mail' });
  expect(new TextDecoder().decode(await pdf.arrayBuffer())).toBe('%PDF-1.7');
  await expect(image.blob()).resolves.toMatchObject({
    size: 4,
    type: 'image/png',
  });
  expect(state.retire).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  expect(state.fetchProof).not.toHaveBeenCalled();
  expect(state.generation.capture()).toBe(current.generation);
  // A decoded in-memory result cannot borrow the newly learned write stamp.
  expect(state.captured).toBe(hint.generation);
  expect(state.captured).not.toBe(current.generation);
});

it.each([
  {
    name: 'denied policy',
    mirror: hint,
    current: { ...hint, policy: '00000000-0000-4000-8000-000000000002:denied' },
    scope: 'permission',
  },
  {
    name: 'already denied mirror',
    mirror: { ...hint, policy: '00000000-0000-4000-8000-000000000002:denied' },
    current: { ...hint, policy: '00000000-0000-4000-8000-000000000002:denied' },
    scope: 'permission',
  },
  {
    name: 'different team',
    mirror: hint,
    current: {
      ...hint,
      policy: '00000000-0000-4000-8000-000000000003:allowed',
    },
    scope: 'permission',
  },
  {
    name: 'different mirrored account',
    mirror: { ...hint, account: 'previous-viewer' },
    current: hint,
    scope: 'session',
  },
  {
    name: 'different owner account',
    mirror: hint,
    current: { ...hint, account: 'previous-viewer' },
    scope: 'session',
  },
  {
    name: 'unfinished cleanup without a mirror',
    mirror: undefined,
    current: { ...hint, ready: false },
    scope: 'permission',
  },
])(
  'retires in-memory bodies on the first baseline with $name',
  async ({ mirror, current, scope }) => {
    const owner = { ...current, generation: crypto.randomUUID() };
    const state = startup(mirror, owner);
    const json = state.guard(Response.json({ subject: 'Previous content' }));
    const binary = state.guard(new Response(new Uint8Array([137, 80, 78, 71])));
    await state.authority.initialize();
    await Promise.all(state.retire.mock.results.map((result) => result.value));
    expect(state.retire).toHaveBeenCalledExactlyOnceWith(
      scope,
      expect.any(String)
    );
    expect(state.cleanup).toHaveBeenCalledOnce();
    await expect(json.json()).rejects.toBeInstanceOf(StaleCacheAuthorityError);
    await expect(binary.arrayBuffer()).rejects.toBeInstanceOf(
      StaleCacheAuthorityError
    );
    expect(state.fetchProof).not.toHaveBeenCalled();
  }
);

it.each([
  { name: 'ready allowed owner', owner: hint },
  {
    name: 'bound legacy owner',
    owner: { ...hint, policy: null, ready: false },
  },
  {
    name: 'new unbound owner',
    owner: { ...hint, account: null, policy: null, ready: false },
  },
])(
  'keeps visible responses during missing-mirror recovery for $name',
  async ({ owner }) => {
    const state = startup(undefined, owner);
    const changed = vi.fn();
    state.generation.onChanged(changed);
    const response = state.guard(Response.json({ subject: 'Personal mail' }));

    await state.authority.initialize();

    await expect(response.json()).resolves.toEqual({
      subject: 'Personal mail',
    });
    expect(state.retire).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(state.fetchProof).not.toHaveBeenCalled();
    expect(state.initialize).toHaveBeenCalledExactlyOnceWith(owner.generation);
    expect(state.generation.capture()).toBe(owner.generation);
    // The response can stay visible, but its original unknown write stamp cannot
    // be admitted by an owner that now exposes its real generation.
    expect(state.captured).not.toBe(owner.generation);
  }
);
