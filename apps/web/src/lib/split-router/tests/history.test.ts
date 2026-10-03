import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserHistory } from '../history/browser';
import { createMemoryHistory } from '../history/memory';
import { readSlice, STATE_KEY, toMountLocation } from '../history/shared';
import {
  createSolidRouterHistory,
  type SolidRouterHistoryOptions,
} from '../history/solid-router';
import type { ExternalChange } from '../history/types';
import { decodePanes, parseLocation } from '../routes/codec';
import { createRoutesManifest } from '../routes/manifest';
import type { ExternalLocation, PaneId } from '../routes/types';
import { createFakeSolidRouter } from './fake-solid-router';
import { appRoutes } from './fixtures';

const stateFor = (entry: string) => ({
  panes: [{ pane: 'p1' as PaneId, entry }],
});
const at = (path: string, entry = 'e1'): ExternalLocation => ({
  ...parseLocation(path),
  state: stateFor(entry),
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('history helpers', () => {
  it('matches the base on a segment boundary', () => {
    expect(toMountLocation('/app', '/app')?.path).toBe('/');
    expect(toMountLocation('/app/mail', '/app')?.path).toBe('/mail');
    expect(toMountLocation('/application', '/app')).toBeUndefined();
  });

  it('reads only non-negative whole history indexes', () => {
    const slice = (index: unknown) => ({ [STATE_KEY]: { index } });
    expect(readSlice(slice(2))?.index).toBe(2);
    expect(readSlice(slice(-1))).toBeUndefined();
    expect(readSlice(slice(1.5))).toBeUndefined();
    expect(readSlice(slice(Number.NaN))).toBeUndefined();
  });
});

describe('memory history', () => {
  it('never reports its own writes', () => {
    const history = createMemoryHistory('/a');
    const listener = vi.fn();
    history.subscribe(listener);
    history.write(at('/b'), { mode: 'push' });
    history.write(at('/c'), { mode: 'replace' });
    expect(listener).not.toHaveBeenCalled();
    expect(history.entries().map((entry) => entry.path)).toEqual(['/a', '/c']);
  });

  it('reports traversal and reverts it', () => {
    const history = createMemoryHistory('/a');
    history.write(at('/b'), { mode: 'push' });
    const changes: ExternalChange[] = [];
    history.subscribe((change) => changes.push(change));
    history.back();
    expect(changes.map((change) => change.location.path)).toEqual(['/a']);
    changes[0]!.revert();
    expect(history.read().path).toBe('/b');
  });

  it('lets interceptors veto outside navigations', async () => {
    const history = createMemoryHistory('/a');
    const listener = vi.fn();
    history.subscribe(listener);
    const stop = history.intercept(() => false);
    await expect(history.navigate('/x')).resolves.toBe(false);
    expect(history.read().path).toBe('/a');
    stop();
    history.intercept(async () => true);
    await expect(history.navigate('/y')).resolves.toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(history.read().path).toBe('/y');
  });
});

describe('browser history', () => {
  beforeEach(() => window.history.replaceState(null, '', '/app/home'));

  it('reads mount-relative locations and records positions on write', () => {
    const history = createBrowserHistory({ base: '/app' });
    expect(history.read()).toMatchObject({ path: '/home' });
    history.write(at('/mail?x=1'), { mode: 'push' });
    expect(window.location.pathname).toBe('/app/mail');
    expect(window.history.state.__splitRouter).toEqual({
      index: 1,
      value: stateFor('e1'),
    });
    expect(history.read()).toEqual({
      path: '/mail',
      search: '?x=1',
      hash: '',
      state: stateFor('e1'),
    });
    expect(history.href({ path: '/mail', search: '?q=1', hash: '' })).toBe(
      '/app/mail?q=1'
    );
  });

  it('reports back/forward, and a revert returns to the previous entry', async () => {
    const history = createBrowserHistory({ base: '/app' });
    history.write(at('/home', 'e1'), { mode: 'replace' });
    history.write(at('/mail', 'e2'), { mode: 'push' });
    const changes: ExternalChange[] = [];
    history.subscribe((change) => changes.push(change));

    const popped = () =>
      new Promise((resolve) =>
        window.addEventListener('popstate', resolve, { once: true })
      );
    const back = popped();
    window.history.back();
    await back;
    expect(changes.map((change) => change.location.path)).toEqual(['/home']);

    await changes[0]!.revert();
    expect(window.location.pathname).toBe('/app/mail');
    expect(changes.map((change) => change.location.path)).toEqual([
      '/home',
      '/mail',
    ]);
  });

  it('rewrites legacy multi-pane paths through transformPath', () => {
    // Pre-`~` URLs listed each pane as a `type/id` pair in one path.
    const upgradeLegacy = (path: string) => {
      const segments = path.split('/').filter(Boolean);
      const pairs = segments.length >= 4 && segments.length % 2 === 0;
      if (!pairs) return path;
      const panes = [];
      for (let index = 0; index < segments.length; index += 2) {
        if (!['md', 'pdf', 'channel'].includes(segments[index]!)) return path;
        panes.push(`${segments[index]}/${segments[index + 1]}`);
      }
      return `/${panes.join('/~/')}`;
    };
    window.history.replaceState(null, '', '/app/md/a/pdf/b');
    const history = createBrowserHistory({
      base: '/app',
      transformPath: upgradeLegacy,
    });
    const decoded = decodePanes(
      createRoutesManifest(appRoutes),
      history.read()
    );
    expect(
      decoded.panes.map((pane) => pane.entry.location.route.matches[1]!.params)
    ).toEqual([
      { type: 'md', id: 'a' },
      { type: 'pdf', id: 'b' },
    ]);

    window.history.replaceState(null, '', '/app/drive/md/a');
    expect(history.read().path).toBe('/drive/md/a');
  });
});

describe('Solid Router history', () => {
  const adapterFor = (
    router: ReturnType<typeof createFakeSolidRouter>,
    options: Partial<SolidRouterHistoryOptions> = {}
  ) =>
    createSolidRouterHistory({
      location: router.location,
      navigate: router.navigate,
      beforeLeave: router.beforeLeave,
      base: '/app',
      ...options,
    });

  it('writes in a later task, merges writes, and skips its own write landing', () => {
    vi.useFakeTimers();
    const router = createFakeSolidRouter('/app/home');
    const listener = vi.fn();
    const { history, dispose } = createRoot((dispose) => {
      const history = adapterFor(router);
      history.subscribe(listener);
      return { history, dispose };
    });

    history.write(at('/mail'), { mode: 'push' });
    history.write(at('/mail/t1'), { mode: 'replace' });
    expect(router.calls).toEqual([]);
    vi.runAllTimers();

    expect(router.calls).toEqual([
      [
        '/mail/t1',
        {
          replace: false,
          scroll: false,
          state: { __splitRouter: { index: 1, value: stateFor('e1') } },
        },
      ],
    ]);
    expect(listener).not.toHaveBeenCalled();
    expect(history.read()).toEqual({
      path: '/mail/t1',
      search: '',
      hash: '',
      state: stateFor('e1'),
    });
    dispose();
  });

  it('strips the base and applies the path transform', () => {
    const router = createFakeSolidRouter('/app/s_abc');
    createRoot((dispose) => {
      const history = adapterFor(router, {
        transformPath: (path) => path.replace('s_abc', 'md/abc'),
      });
      expect(history.read().path).toBe('/md/abc');
      dispose();
    });
  });

  it('reports back/forward, and a revert settles once it has landed', async () => {
    vi.useFakeTimers();
    const router = createFakeSolidRouter('/app/home');
    const changes: ExternalChange[] = [];
    const { history, dispose } = createRoot((dispose) => {
      const history = adapterFor(router);
      history.subscribe((change) => changes.push(change));
      return { history, dispose };
    });
    history.write(at('/home', 'e1'), { mode: 'replace' });
    vi.runAllTimers();
    history.write(at('/mail', 'e2'), { mode: 'push' });
    vi.runAllTimers();

    router.traverse(-1);
    expect(changes.map((change) => change.location.path)).toEqual(['/home']);
    const reverted = changes[0]!.revert();
    expect(history.read().path).toBe('/home');
    await reverted;
    expect(router.calls.at(-1)).toEqual([1, undefined]);
    expect(history.read().path).toBe('/mail');
    expect(changes.map((change) => change.location.path)).toEqual([
      '/home',
      '/mail',
    ]);
    dispose();
  });

  it('reports every location under its base and ignores the rest', () => {
    const router = createFakeSolidRouter('/app/home');
    const listener = vi.fn();
    const dispose = createRoot((dispose) => {
      adapterFor(router).subscribe(listener);
      return dispose;
    });
    router.show('/elsewhere', undefined);
    expect(listener).not.toHaveBeenCalled();
    router.show('/app/login', undefined);
    expect(listener).toHaveBeenCalledOnce();
    dispose();
  });

  it('intercepts outside navigations through beforeLeave', async () => {
    const router = createFakeSolidRouter('/app/home');
    const verdicts: (boolean | Promise<boolean>)[] = [
      false,
      Promise.resolve(true),
      true,
    ];
    const seen: (ExternalLocation | undefined)[] = [];
    const dispose = createRoot((dispose) => {
      adapterFor(router).intercept?.((location) => {
        seen.push(location);
        return verdicts.shift()!;
      });
      return dispose;
    });

    const blocked = router.leave('/app/mail/t1');
    expect(blocked.preventDefault).toHaveBeenCalled();
    expect(seen[0]).toEqual({ path: '/mail/t1', search: '', hash: '' });

    const deferred = router.leave('/elsewhere');
    expect(seen[1]).toBeUndefined();
    expect(deferred.preventDefault).toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(deferred.retry).toHaveBeenCalledWith(true);

    const allowed = router.leave('/app/mail');
    expect(allowed.preventDefault).not.toHaveBeenCalled();

    const traversal = router.leave(-1);
    expect(traversal.preventDefault).not.toHaveBeenCalled();
    expect(seen).toHaveLength(3);
    dispose();
  });
});
