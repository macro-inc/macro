import { beforeEach, expect, it, vi } from 'vitest';
import { callerDisplayName } from './caller-name';

const mocks = vi.hoisted(() => ({
  loading: true,
  listeners: new Set<() => void>(),
}));

vi.mock('@queries/auth/user-name-cache-runtime', () => ({
  userNameCache: () => ({ read: () => ({ loading: mocks.loading }) }),
}));
vi.mock('@solid-primitives/promise', () => ({
  // Re-checks the condition whenever the fake cache finishes loading.
  until: (condition: () => boolean) =>
    new Promise<boolean>((resolve) => {
      const check = () => {
        if (!condition()) return;
        mocks.listeners.delete(check);
        resolve(true);
      };
      mocks.listeners.add(check);
      check();
    }),
  raceTimeout: (promise: Promise<unknown>, ms: number) =>
    Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(undefined), ms)),
    ]),
}));
vi.mock('@core/user/util', () => ({
  idToDisplayName: (id: string) => {
    if (id === 'macro|ada@example.com')
      return mocks.loading ? 'ada' : 'Ada Lovelace';
    return id === 'macro|qareen@example.com' ? 'qareen' : '';
  },
}));

function finishLoading() {
  mocks.loading = false;
  for (const listener of [...mocks.listeners]) listener();
}

beforeEach(() => {
  mocks.loading = true;
  mocks.listeners.clear();
  vi.useRealTimers();
});

it('waits for the name to load before naming the caller', async () => {
  const name = callerDisplayName('macro|ada@example.com');
  await Promise.resolve();
  finishLoading();

  expect(await name).toBe('Ada Lovelace');
});

it('falls back to the address local part when the name never loads', async () => {
  vi.useFakeTimers();
  const name = callerDisplayName('macro|ada@example.com');
  await vi.advanceTimersByTimeAsync(1000);

  expect(await name).toBe('ada');
});

it('uses the address local part, not the whole email, for a caller without a name', async () => {
  mocks.loading = false;

  expect(await callerDisplayName('macro|qareen@example.com')).toBe('qareen');
});
