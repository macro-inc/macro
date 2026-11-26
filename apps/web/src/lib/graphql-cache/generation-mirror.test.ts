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
it('retires nothing for a start that began under the recorded denial', () => {
  expect(initialCacheRetirement(denied, denied)).toBeUndefined();
});

it.each([
  ['the start began while access was still allowed', authority],
  [
    'the start began under an earlier denial',
    { ...denied, generation: '00000000-0000-4000-8000-000000000004' },
  ],
  ['the start had no record of the owner', undefined],
] as const)(
  'retires what a start restored for a recorded denial when %s',
  (_case, hint) => {
    expect(initialCacheRetirement(hint, denied)).toBe('permission');
  }
);

// A page can unload between the owner recording a first bind or a first grant
// and the page mirroring it: the next start reads a mirror one step behind.
const TEAM = '00000000-0000-4000-8000-000000000002';
const OTHER_GENERATION = '00000000-0000-4000-8000-000000000005';
const unbound: CacheAuthority = {
  ...authority,
  account: null,
  policy: null,
  ready: false,
};
const bound: CacheAuthority = { ...unbound, account: 'viewer' };
const granted: CacheAuthority = {
  ...bound,
  policy: `${TEAM}:allowed`,
  ready: true,
};
it.each([
  ['the first bind', unbound, bound],
  ['the first grant', bound, granted],
  ['a first team-less proof', bound, { ...granted, policy: 'none' }],
  ['the first bind and grant together', unbound, granted],
] as const)(
  'retires nothing when the mirror only lags %s of the same generation',
  (_case, hint, owner) => {
    expect(initialCacheRetirement(hint, owner)).toBeUndefined();
  }
);

it.each([
  [
    'another account at the same generation',
    { ...bound, account: 'someone-else' },
    bound,
    'session',
  ],
  [
    'no account at an earlier generation',
    { ...unbound, generation: OTHER_GENERATION },
    bound,
    'session',
  ],
  [
    'another team at the same generation',
    { ...granted, policy: '00000000-0000-4000-8000-000000000009:allowed' },
    granted,
    'permission',
  ],
  [
    'a team when the owner now records none',
    granted,
    { ...granted, policy: 'none' },
    'permission',
  ],
  [
    'no policy at an earlier generation',
    { ...bound, generation: OTHER_GENERATION },
    granted,
    'permission',
  ],
  [
    'a grant the owner has since revoked',
    granted,
    { ...granted, policy: `${TEAM}:denied`, generation: OTHER_GENERATION },
    'permission',
  ],
  [
    'no policy where the owner records a denial, even at one generation',
    bound,
    { ...granted, policy: `${TEAM}:denied` },
    'permission',
  ],
  [
    'no account where the owner records a denial, even at one generation',
    { ...granted, account: null, policy: `${TEAM}:denied` },
    { ...granted, policy: `${TEAM}:denied` },
    'session',
  ],
  [
    'no policy where the owner has an unfinished transition',
    bound,
    { ...granted, ready: false },
    'permission',
  ],
] as const)(
  'still retires when the mirror names %s',
  (_case, hint, owner, scope) => {
    expect(initialCacheRetirement(hint, owner)).toBe(scope);
  }
);
