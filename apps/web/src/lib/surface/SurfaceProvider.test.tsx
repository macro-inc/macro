/**
 * @vitest-environment jsdom
 */

import { createEffect, createSignal, type JSX, on } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSurfaceDirectory, DEFAULT_METHOD_TIMEOUT_MS } from './directory';
import {
  SurfaceProvider,
  useMaybeSurface,
  useSurface,
  useSurfaceMethods,
  useSurfaceParams,
} from './SurfaceProvider';

let disposeView: (() => void) | undefined;

function renderView(fn: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(fn, container);
  disposeView = () => {
    dispose();
    container.remove();
  };
  return { unmount: disposeView };
}

afterEach(() => {
  disposeView?.();
  disposeView = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SurfaceProvider', () => {
  it('useSurface throws outside a provider; useMaybeSurface returns undefined', () => {
    expect(() =>
      renderView(() => {
        useSurface();
        return null;
      })
    ).toThrow(/useSurface\(\) called outside a SurfaceProvider/);

    let maybe: ReturnType<typeof useMaybeSurface> | undefined;
    renderView(() => {
      maybe = useMaybeSurface();
      return null;
    });
    expect(maybe).toBeUndefined();
  });

  it('nested provider sets nested and does not provide', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const directory = createSurfaceDirectory();
    let outerRan = false;
    let innerRan = false;
    let nested = false;

    const Inner = () => {
      const surface = useSurface();
      nested = surface.nested;
      useSurfaceMethods({
        goToLatest: () => {
          innerRan = true;
        },
      });
      return null;
    };

    const Outer = () => {
      useSurfaceMethods({
        goToLatest: () => {
          outerRan = true;
        },
      });
      return (
        <SurfaceProvider id={() => 'inner'} directory={directory}>
          <Inner />
        </SurfaceProvider>
      );
    };

    renderView(() => (
      <SurfaceProvider id={() => 'outer'} directory={directory}>
        <Outer />
      </SurfaceProvider>
    ));

    expect(nested).toBe(true);

    await directory.handle('outer').goToLatest();
    expect(outerRan).toBe(true);
    expect(innerRan).toBe(false);

    const innerCall = directory.handle('inner').goToLatest();
    await vi.advanceTimersByTimeAsync(DEFAULT_METHOD_TIMEOUT_MS);
    await expect(innerCall).resolves.toBeUndefined();
  });

  it('useSurfaceMethods registers into the directory and deregisters on owner cleanup', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const directory = createSurfaceDirectory();
    let ran = false;
    const [show, setShow] = createSignal(true);

    const Child = () => {
      useSurfaceMethods({
        goToLatest: () => {
          ran = true;
        },
      });
      return null;
    };

    renderView(() => (
      <SurfaceProvider id={() => 'owner'} directory={directory}>
        {show() ? <Child /> : null}
      </SurfaceProvider>
    ));

    await directory.handle('owner').goToLatest();
    expect(ran).toBe(true);

    ran = false;
    setShow(false);
    const gone = directory.handle('owner').goToLatest();
    await vi.advanceTimersByTimeAsync(DEFAULT_METHOD_TIMEOUT_MS);
    await expect(gone).resolves.toBeUndefined();
    expect(ran).toBe(false);
  });

  it('rekeys reactively: old key dies, new key answers, and a pre-flip call on the new key resolves', async () => {
    const directory = createSurfaceDirectory();
    const [id, setId] = createSignal('pending-x');
    let ranOn: string | undefined;

    const Methods = () => {
      useSurfaceMethods({
        goToLatest: () => {
          ranOn = id();
        },
      });
      return null;
    };

    renderView(() => (
      <SurfaceProvider id={id} directory={directory}>
        <Methods />
      </SurfaceProvider>
    ));

    const pendingNew = directory.handle('session-y').goToLatest();
    setId('session-y');
    await pendingNew;
    expect(ranOn).toBe('session-y');
    ranOn = undefined;
    await directory.handle('session-y').goToLatest();
    expect(ranOn).toBe('session-y');
  });

  it('useSurfaceParams returns the mount-time snapshot and the accessor never re-fires', async () => {
    const directory = createSurfaceDirectory();
    const params: Record<string, never> = {};
    let reads = 0;
    let last: unknown;
    const [tick, setTick] = createSignal(0);

    const Consumer = () => {
      const snapshot = useSurfaceParams<'image'>();
      createEffect(
        on(snapshot, (value) => {
          last = value;
          reads++;
        })
      );
      createEffect(() => {
        tick();
      });
      return null;
    };

    renderView(() => (
      <SurfaceProvider
        id={() => 'params'}
        params={params}
        directory={directory}
      >
        <Consumer />
      </SurfaceProvider>
    ));

    expect(reads).toBe(1);
    expect(last).toEqual({});
    Object.assign(params, { marker: 'b' });
    setTick(1);
    await Promise.resolve();
    expect(reads).toBe(1);
    expect(last).toEqual({});
  });
});
