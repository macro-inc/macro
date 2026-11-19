import { afterEach, expect, it, vi } from 'vitest';
import { type CacheAuthority, createAuthorityObserver } from './authority';
import {
  initialCacheRetirement,
  readGenerationMirror,
  rememberGeneration,
  UNKNOWN_CACHE_GENERATION,
} from './generation-mirror';
import { createSessionGeneration } from './session-generation';

afterEach(() => vi.unstubAllGlobals());

const authority: CacheAuthority = {
  identity: 'profile',
  account: 'viewer',
  generation: '00000000-0000-4000-8000-000000000001',
  policy: '00000000-0000-4000-8000-000000000002:allowed',
  ready: true,
};

it('confirms an unchanged boot hint without refetching or consulting storage again', () => {
  const storage = {
    getItem: vi.fn(() => JSON.stringify(authority)),
    setItem: vi.fn(),
  };
  vi.stubGlobal('localStorage', storage);
  const hint = readGenerationMirror('profile');
  expect(hint).toEqual(authority);
  const session = createSessionGeneration(hint?.generation);
  const changed = vi.fn();
  session.onChanged(changed);
  const request = session.capture();
  session.initialize(authority.generation);
  expect(session.isCurrent(request)).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  expect(storage.getItem).toHaveBeenCalledOnce();
});

it('mirrors validated owner identity and policy without adopting late storage changes', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const owner = createAuthorityObserver('profile');
  owner.observe(authority);
  const session = createSessionGeneration(
    readGenerationMirror('profile')?.generation
  );
  const next = { ...authority, generation: crypto.randomUUID() };
  owner.observe(next);
  session.initialize(next.generation);
  rememberGeneration(authority);
  expect(session.capture()).toBe(next.generation);
  expect(session.isCurrent(authority.generation)).toBe(true);
  expect(readGenerationMirror('other-profile')).toBeUndefined();
  expect(() =>
    owner.observe({ ...authority, identity: 'other-profile' })
  ).toThrow();
  expect(readGenerationMirror('profile')).toEqual(authority);
});

it.each([
  null,
  '',
  'broken',
  'none',
  '{}',
  JSON.stringify({ ...authority, generation: 'broken' }),
])('uses a nonmatching UUID for an absent or corrupt hint: %s', (value) => {
  vi.stubGlobal('localStorage', { getItem: () => value });
  const hint = readGenerationMirror('profile');
  expect(hint).toBeUndefined();
  expect(createSessionGeneration(hint?.generation).capture()).toBe(
    UNKNOWN_CACHE_GENERATION
  );
});

it('keeps storage failures outside startup and the authority transition', () => {
  vi.stubGlobal('localStorage', {
    getItem() {
      throw new Error('unavailable');
    },
    setItem() {
      throw new Error('unavailable');
    },
  });
  expect(readGenerationMirror('profile')).toBeUndefined();
  expect(() => rememberGeneration(authority)).not.toThrow();
});

const denied: CacheAuthority = {
  ...authority,
  generation: '00000000-0000-4000-8000-000000000003',
  policy: '00000000-0000-4000-8000-000000000002:denied',
};
it('skips the prune only for a start that began under the recorded denial with its prune complete', () => {
  expect(
    initialCacheRetirement(denied, denied, denied.generation)
  ).toBeUndefined();
});

it.each([
  ['the prune for it never completed', denied, undefined],
  [
    'the completed prune was for an earlier generation',
    denied,
    authority.generation,
  ],
  [
    'the start began while access was still allowed',
    authority,
    denied.generation,
  ],
  [
    'the start began under an earlier denial',
    { ...denied, generation: '00000000-0000-4000-8000-000000000004' },
    denied.generation,
  ],
  ['the start had no record of the owner', undefined, denied.generation],
] as const)(
  'retires what a start restored for a recorded denial when %s',
  (_case, hint, pruned) => {
    expect(initialCacheRetirement(hint, denied, pruned)).toBe('permission');
  }
);
