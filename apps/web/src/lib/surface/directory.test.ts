import { afterEach, describe, expect, it, vi } from 'vitest';
import { sameSurfaceIdentity } from './catalog';
import {
  awaitCondition,
  createSurfaceDirectory,
  DEFAULT_METHOD_TIMEOUT_MS,
  type SurfaceDirectory,
} from './directory';

function provideLatest(
  directory: SurfaceDirectory,
  id: string,
  fn: () => void | Promise<void>
) {
  return directory.provide(id, { goToLatest: fn });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('surface directory await semantics', () => {
  it('runs a method provided before the call, wrapping sync and awaiting async', async () => {
    const directory = createSurfaceDirectory();
    const forwarded: Record<string, string>[] = [];
    directory.provide('a', {
      goToLocationFromParams: (params) => {
        forwarded.push(params);
      },
    });
    await directory.handle('a').goToLocationFromParams({ foo: 'hi' });
    expect(forwarded).toEqual([{ foo: 'hi' }]);

    let asyncValue = 0;
    directory.provide('b', {
      goToLatest: async () => {
        await Promise.resolve();
        asyncValue = 2;
      },
    });
    await directory.handle('b').goToLatest();
    expect(asyncValue).toBe(2);
  });

  it('resolves a call issued before registration once provide lands', async () => {
    const directory = createSurfaceDirectory();
    let received: Record<string, string> | undefined;
    const pending = directory
      .handle('late')
      .goToLocationFromParams({ k: 'arg' });
    directory.provide('late', {
      goToLocationFromParams: (params) => {
        received = params;
      },
    });
    await pending;
    expect(received).toEqual({ k: 'arg' });
  });

  it('runs the newest fn when a re-provide lands while a call waits', async () => {
    const directory = createSurfaceDirectory();
    let winner = '';
    const pending = directory.handle('race').goToLatest();
    provideLatest(directory, 'race', () => {
      winner = 'first';
    });
    provideLatest(directory, 'race', () => {
      winner = 'second';
    });
    await pending;
    expect(winner).toBe('second');
  });

  it('lets a handle created before registration resolve later (pin-key/late-resolve)', async () => {
    const directory = createSurfaceDirectory();
    const handle = directory.handle('pinned');
    let value = '';
    provideLatest(directory, 'pinned', () => {
      value = 'late';
    });
    await handle.goToLatest();
    expect(value).toBe('late');
  });

  it('is not a thenable: then/catch/finally are undefined and await does not recurse', async () => {
    const directory = createSurfaceDirectory();
    const handle = directory.handle('thenable');
    expect(Reflect.get(handle, 'then')).toBeUndefined();
    expect(Reflect.get(handle, 'catch')).toBeUndefined();
    expect(Reflect.get(handle, 'finally')).toBeUndefined();
    expect(await handle).toBe(handle);
  });
});

describe('surface directory timeout', () => {
  it('never-provided method resolves undefined after DEFAULT_METHOD_TIMEOUT_MS without throwing or rejecting', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const directory = createSurfaceDirectory();
    const pending = directory.handle('missing').goToLatest();
    await vi.advanceTimersByTimeAsync(DEFAULT_METHOD_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('surface method timed out: missing.goToLatest')
    );
  });

  it('re-checks awaitCondition at timer expiry before rejecting', async () => {
    vi.useFakeTimers();
    let ready = false;
    const pending = awaitCondition(() => ready, 1000);
    ready = true;
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBeUndefined();
  });
});

describe('surface directory dispose ordering', () => {
  it('provide disposer removes exactly its methods; other keys and providers stay', async () => {
    const directory = createSurfaceDirectory();
    let a = '';
    let c = '';
    provideLatest(directory, 'a', () => {
      a = 'a';
    });
    const disposeB = provideLatest(directory, 'b', () => {
      /* removed */
    });
    provideLatest(directory, 'c', () => {
      c = 'c';
    });
    disposeB();
    await directory.handle('a').goToLatest();
    await directory.handle('c').goToLatest();
    expect(a).toBe('a');
    expect(c).toBe('c');

    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gone = directory.handle('b').goToLatest();
    await vi.advanceTimersByTimeAsync(DEFAULT_METHOD_TIMEOUT_MS);
    await expect(gone).resolves.toBeUndefined();
  });

  it('overlapping provides: second wins; first disposer does not remove it; second disposer does', async () => {
    const directory = createSurfaceDirectory();
    let winner = '';
    const first = provideLatest(directory, 'x', () => {
      winner = 'first';
    });
    const second = provideLatest(directory, 'x', () => {
      winner = 'second';
    });
    await directory.handle('x').goToLatest();
    expect(winner).toBe('second');
    first();
    winner = '';
    await directory.handle('x').goToLatest();
    expect(winner).toBe('second');
    second();

    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gone = directory.handle('x').goToLatest();
    await vi.advanceTimersByTimeAsync(DEFAULT_METHOD_TIMEOUT_MS);
    await expect(gone).resolves.toBeUndefined();
  });
});

describe('surface directory reactive rekey', () => {
  it('a call against B issued before a disposeA/provideB batch resolves once the batch lands', async () => {
    const directory = createSurfaceDirectory();
    const disposeProvideA = provideLatest(directory, 'pending-x', () => {
      /* old */
    });

    let value = '';
    const pendingB = directory.handle('session-y').goToLatest();
    disposeProvideA();
    provideLatest(directory, 'session-y', () => {
      value = 'new';
    });

    await pendingB;
    expect(value).toBe('new');
  });

  it('a call against A after the rekey batch times out to undefined', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const directory = createSurfaceDirectory();
    const disposeProvideA = provideLatest(directory, 'pending-x', () => {
      /* old */
    });
    disposeProvideA();
    provideLatest(directory, 'session-y', () => {
      /* new */
    });

    const stale = directory.handle('pending-x').goToLatest();
    await vi.advanceTimersByTimeAsync(DEFAULT_METHOD_TIMEOUT_MS);
    await expect(stale).resolves.toBeUndefined();
  });
});

describe('catalog dedupe identity', () => {
  // The singleton branch stays uncovered until a singleton catalog entry exists.
  it('entity surfaces dedupe on id; app surfaces never dedupe; names must match', () => {
    expect(
      sameSurfaceIdentity(
        { name: 'image', id: 'a' },
        { name: 'image', id: 'a' }
      )
    ).toBe(true);
    expect(
      sameSurfaceIdentity(
        { name: 'image', id: 'a' },
        { name: 'image', id: 'b' }
      )
    ).toBe(false);
    expect(
      sameSurfaceIdentity(
        { name: 'image', id: 'a' },
        { name: 'inbox', id: 'a' }
      )
    ).toBe(false);
    expect(
      sameSurfaceIdentity(
        { name: 'inbox', id: 'a' },
        { name: 'inbox', id: 'a' }
      )
    ).toBe(false);
  });
});
