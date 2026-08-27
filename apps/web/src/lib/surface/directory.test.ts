import { createEffect, createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sameSurfaceIdentity } from './catalog';
import {
  awaitCondition,
  createSurfaceDirectory,
  DEFAULT_METHOD_TIMEOUT_MS,
  type SurfaceDirectory,
} from './directory';
import type { SurfaceName } from './specs';

function provideLatest(
  directory: SurfaceDirectory,
  name: SurfaceName,
  id: string,
  fn: () => void | Promise<void>
) {
  return directory.provide(name, id, { goToLatest: fn });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('surface directory await semantics', () => {
  it('runs a method provided before the call, wrapping sync and awaiting async', async () => {
    const directory = createSurfaceDirectory();
    const forwarded: Record<string, string>[] = [];
    directory.provide('image', 'a', {
      goToLocationFromParams: (params) => {
        forwarded.push(params);
      },
    });
    await directory.handle('image', 'a').goToLocationFromParams({ foo: 'hi' });
    expect(forwarded).toEqual([{ foo: 'hi' }]);

    let asyncValue = 0;
    directory.provide('image', 'b', {
      goToLatest: async () => {
        await Promise.resolve();
        asyncValue = 2;
      },
    });
    await directory.handle('image', 'b').goToLatest();
    expect(asyncValue).toBe(2);
  });

  it('resolves a call issued before registration once provide lands', async () => {
    const directory = createSurfaceDirectory();
    let received: Record<string, string> | undefined;
    const pending = directory
      .handle('image', 'late')
      .goToLocationFromParams({ k: 'arg' });
    directory.provide('image', 'late', {
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
    const pending = directory.handle('image', 'race').goToLatest();
    provideLatest(directory, 'image', 'race', () => {
      winner = 'first';
    });
    provideLatest(directory, 'image', 'race', () => {
      winner = 'second';
    });
    await pending;
    expect(winner).toBe('second');
  });

  it('lets a handle created before registration resolve later (pin-key/late-resolve)', async () => {
    const directory = createSurfaceDirectory();
    const handle = directory.handle('image', 'pinned');
    let value = '';
    provideLatest(directory, 'image', 'pinned', () => {
      value = 'late';
    });
    await handle.goToLatest();
    expect(value).toBe('late');
  });

  it('is not a thenable: then/catch/finally are undefined and await does not recurse', async () => {
    const directory = createSurfaceDirectory();
    const handle = directory.handle('image', 'thenable');
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
    const pending = directory.handle('image', 'missing').goToLatest();
    await vi.advanceTimersByTimeAsync(DEFAULT_METHOD_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'surface method timed out: image:missing.goToLatest'
      )
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
    let inbox = '';
    provideLatest(directory, 'image', 'a', () => {
      a = 'a';
    });
    const disposeB = provideLatest(directory, 'image', 'b', () => {
      /* removed */
    });
    provideLatest(directory, 'inbox', 'a', () => {
      inbox = 'inbox';
    });
    disposeB();
    await directory.handle('image', 'a').goToLatest();
    await directory.handle('inbox', 'a').goToLatest();
    expect(a).toBe('a');
    expect(inbox).toBe('inbox');

    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gone = directory.handle('image', 'b').goToLatest();
    await vi.advanceTimersByTimeAsync(DEFAULT_METHOD_TIMEOUT_MS);
    await expect(gone).resolves.toBeUndefined();
  });

  it('overlapping provides: second wins; first disposer does not remove it; second disposer does', async () => {
    const directory = createSurfaceDirectory();
    let winner = '';
    const first = provideLatest(directory, 'image', 'x', () => {
      winner = 'first';
    });
    const second = provideLatest(directory, 'image', 'x', () => {
      winner = 'second';
    });
    await directory.handle('image', 'x').goToLatest();
    expect(winner).toBe('second');
    first();
    winner = '';
    await directory.handle('image', 'x').goToLatest();
    expect(winner).toBe('second');
    second();

    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gone = directory.handle('image', 'x').goToLatest();
    await vi.advanceTimersByTimeAsync(DEFAULT_METHOD_TIMEOUT_MS);
    await expect(gone).resolves.toBeUndefined();
  });

  it('removes the entry only when announceCount is 0 and no methods remain', () => {
    const directory = createSurfaceDirectory();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const disposeAnnounce = directory.announce('image', 'prune');
    const disposeProvide = provideLatest(directory, 'image', 'prune', () => {
      /* present */
    });
    expect(directory.isLive('image', 'prune')).toBe(true);
    disposeAnnounce();
    expect(directory.isLive('image', 'prune')).toBe(false);
    disposeProvide();
    warn.mockClear();
    const disposeAgain = directory.announce('image', 'prune');
    expect(directory.isLive('image', 'prune')).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    disposeAgain();
    expect(directory.isLive('image', 'prune')).toBe(false);
  });
});

describe('surface directory announce / isLive', () => {
  it('isLive is false then true on announce then false after dispose, and is reactive', () => {
    const directory = createSurfaceDirectory();
    const seen: boolean[] = [];
    let disposeRoot!: () => void;
    createRoot((dispose) => {
      disposeRoot = dispose;
      createEffect(() => {
        seen.push(directory.isLive('image', 'live'));
      });
    });
    expect(seen).toEqual([false]);
    const stop = directory.announce('image', 'live');
    expect(seen).toEqual([false, true]);
    stop();
    expect(seen).toEqual([false, true, false]);
    disposeRoot();
  });

  it('double-announce stays live after one dispose; second dispose dies; excess dispose never goes negative', () => {
    const directory = createSurfaceDirectory();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = directory.announce('image', 'dup');
    const second = directory.announce('image', 'dup');
    expect(directory.isLive('image', 'dup')).toBe(true);
    first();
    expect(directory.isLive('image', 'dup')).toBe(true);
    second();
    expect(directory.isLive('image', 'dup')).toBe(false);
    second();
    expect(directory.isLive('image', 'dup')).toBe(false);
    const third = directory.announce('image', 'dup');
    expect(directory.isLive('image', 'dup')).toBe(true);
    third();
    expect(directory.isLive('image', 'dup')).toBe(false);
  });

  it('DEV-warns when announce count exceeds 1', () => {
    const directory = createSurfaceDirectory();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = directory.announce('image', 'warn');
    expect(warn).not.toHaveBeenCalled();
    const second = directory.announce('image', 'warn');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('two live mounts share `image:warn`')
    );
    first();
    second();
  });
});

describe('surface directory reactive rekey', () => {
  it('a call against B issued before a disposeA/announceB/provideB batch resolves once the batch lands, and A is gone', async () => {
    const directory = createSurfaceDirectory();
    const disposeAnnounceA = directory.announce('image', 'pending-x');
    const disposeProvideA = provideLatest(
      directory,
      'image',
      'pending-x',
      () => {
        /* old */
      }
    );

    let value = '';
    const pendingB = directory.handle('image', 'session-y').goToLatest();
    disposeAnnounceA();
    disposeProvideA();
    directory.announce('image', 'session-y');
    provideLatest(directory, 'image', 'session-y', () => {
      value = 'new';
    });

    await pendingB;
    expect(value).toBe('new');
    expect(directory.isLive('image', 'pending-x')).toBe(false);
    expect(directory.isLive('image', 'session-y')).toBe(true);
  });

  it('a call against A after the rekey batch times out to undefined', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const directory = createSurfaceDirectory();
    const disposeAnnounceA = directory.announce('image', 'pending-x');
    const disposeProvideA = provideLatest(
      directory,
      'image',
      'pending-x',
      () => {
        /* old */
      }
    );
    disposeAnnounceA();
    disposeProvideA();
    directory.announce('image', 'session-y');
    provideLatest(directory, 'image', 'session-y', () => {
      /* new */
    });

    const stale = directory.handle('image', 'pending-x').goToLatest();
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
