import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, onCleanup, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useQuickAccess } from './context';
import { QuickAccessProvider } from './QuickAccessProvider';

// `scheduleIdle` picks requestIdleCallback at import, so stub it first.
const idle = vi.hoisted(() => {
  const pending = new Map<number, IdleRequestCallback>();
  const timeouts: (number | undefined)[] = [];
  let nextId = 0;
  globalThis.requestIdleCallback = (callback, options) => {
    pending.set(++nextId, callback);
    timeouts.push(options?.timeout);
    return nextId;
  };
  globalThis.cancelIdleCallback = (id) => {
    pending.delete(id);
  };
  const run = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks)
      callback({ didTimeout: false, timeRemaining: () => 50 });
  };
  return { pending, timeouts, run };
});

const [authenticated, setAuthenticated] = createSignal<boolean | undefined>();
const [userId, setUserId] = createSignal<string>();
const [unrelated, setUnrelated] = createSignal(0);
const mountSource = vi.fn();
const disposeSource = vi.fn();
const refresh = vi.fn();
const loadMore = vi.fn();

vi.mock('@core/context/user', () => ({
  useIsAuthenticated: () => authenticated,
  useUserId: () => userId,
}));
vi.mock('@channel/DebugSuspense', () => ({
  DebugSuspense: (props: ParentProps) => props.children,
}));
vi.mock('./QuickAccessSource', () => ({
  createQuickAccessValue: () => {
    const id = userId();
    unrelated();
    const error = new Error(`Unavailable for ${id}`);
    mountSource(id);
    onCleanup(() => disposeSource(id));
    return {
      useList: () => ({
        error: () => error,
        items: () => [{ kind: 'user', id }],
        totalCount: () => 1,
        hasMore: () => true,
        isLoading: () => false,
        isLoadingMore: () => false,
        loadMore,
      }),
      usesRecordSelection: () => true,
      usesSearchProjection: () => true,
      isLoading: () => false,
      refresh,
      getById: (id: string) => ({ kind: 'entity', id }),
    };
  },
}));

afterEach(() => {
  cleanup();
  setAuthenticated(undefined);
  setUserId(undefined);
  idle.pending.clear();
  idle.timeouts.length = 0;
  vi.clearAllMocks();
});

it('keeps consumers mounted while creating and disposing account sources across login and logout', async () => {
  let mounted = 0;
  let refreshCurrent: () => void = () => {};
  let loadCurrent: () => Promise<void> = async () => {};
  let currentError: () => unknown = () => undefined;
  function Consumer() {
    mounted++;
    const access = useQuickAccess();
    const list = access.useList('person');
    refreshCurrent = access.refresh;
    loadCurrent = list.loadMore;
    currentError = list.error;
    return (
      <div>
        {list
          .items()
          .map((item) => item.id)
          .join(',') || 'No account data'}
      </div>
    );
  }
  render(() => (
    <QuickAccessProvider>
      <Consumer />
    </QuickAccessProvider>
  ));
  expect(screen.getByText('No account data')).toBeTruthy();
  expect(mountSource).not.toHaveBeenCalled();
  expect(currentError()).toBeUndefined();
  refreshCurrent();
  await loadCurrent();
  expect(refresh).not.toHaveBeenCalled();
  expect(loadMore).not.toHaveBeenCalled();

  setUserId('alice');
  setAuthenticated(false);
  expect(mountSource).not.toHaveBeenCalled();
  setAuthenticated(true);
  expect(screen.getByText('alice')).toBeTruthy();
  expect(currentError()).toMatchObject({ message: 'Unavailable for alice' });
  refreshCurrent();
  await loadCurrent();
  expect(refresh).toHaveBeenCalledOnce();
  expect(loadMore).toHaveBeenCalledOnce();

  setUserId('bob');
  expect(disposeSource).toHaveBeenCalledWith('alice');
  expect(screen.getByText('bob')).toBeTruthy();
  expect(currentError()).toMatchObject({ message: 'Unavailable for bob' });
  setAuthenticated(false);
  expect(disposeSource).toHaveBeenCalledWith('bob');
  expect(screen.getByText('No account data')).toBeTruthy();
  expect(currentError()).toBeUndefined();
  expect(mountSource).toHaveBeenCalledTimes(2);
  expect(mounted).toBe(1);
});

it('does not mount sources for an unused provider or disabled list', () => {
  setUserId('viewer');
  setAuthenticated(true);
  const [enabled, setEnabled] = createSignal(false);
  function Consumer() {
    const access = useQuickAccess();
    const list = access.useList({ buckets: ['person'], enabled });
    return <div>{list.items().length}</div>;
  }
  render(() => (
    <QuickAccessProvider>
      <Consumer />
    </QuickAccessProvider>
  ));
  expect(mountSource).not.toHaveBeenCalled();
  setEnabled(true);
  expect(mountSource).toHaveBeenCalledOnce();
  expect(screen.getByText('1')).toBeTruthy();
  setEnabled(false);
  expect(screen.getByText('0')).toBeTruthy();
  setEnabled(true);
  expect(mountSource).toHaveBeenCalledOnce();
});

it('keeps cache lookups pure and activates only an enabled list', () => {
  setUserId('viewer');
  setAuthenticated(true);
  const [enabled, setEnabled] = createSignal(false);
  let lookup: (id: string) => unknown = () => undefined;
  function Consumer() {
    const access = useQuickAccess();
    lookup = access.getById;
    access.useList({ buckets: ['document'], enabled });
    return <div>Detail</div>;
  }
  render(() => (
    <QuickAccessProvider>
      <Consumer />
    </QuickAccessProvider>
  ));
  expect(mountSource).not.toHaveBeenCalled();
  expect(lookup('document')).toBeUndefined();
  expect(mountSource).not.toHaveBeenCalled();
  setEnabled(true);
  expect(lookup('document')).toMatchObject({ id: 'document' });
  expect(mountSource).toHaveBeenCalledOnce();
  setUnrelated(1);
  expect(mountSource).toHaveBeenCalledOnce();
  expect(disposeSource).not.toHaveBeenCalled();
});

it('builds the account source on first idle, not during render', () => {
  setUserId('viewer');
  setAuthenticated(true);
  render(() => (
    <QuickAccessProvider>
      <div>App</div>
    </QuickAccessProvider>
  ));
  expect(mountSource).not.toHaveBeenCalled();
  expect(idle.pending.size).toBe(1);
  expect(idle.timeouts).toEqual([2500]);

  idle.run();
  expect(mountSource).toHaveBeenCalledOnce();
  expect(mountSource).toHaveBeenCalledWith('viewer');
});

it('builds the source once when a consumer requests it before idle', () => {
  setUserId('viewer');
  setAuthenticated(true);
  function Consumer() {
    const list = useQuickAccess().useList('person');
    return <div>{list.items().length}</div>;
  }
  render(() => (
    <QuickAccessProvider>
      <Consumer />
    </QuickAccessProvider>
  ));
  expect(mountSource).toHaveBeenCalledOnce();

  idle.run();
  expect(mountSource).toHaveBeenCalledOnce();
  expect(disposeSource).not.toHaveBeenCalled();
});

it('cancels the pending warm-up on account switch and disposal', () => {
  setUserId('alice');
  setAuthenticated(true);
  const { unmount } = render(() => (
    <QuickAccessProvider>
      <div>App</div>
    </QuickAccessProvider>
  ));
  expect(idle.pending.size).toBe(1);

  setUserId('bob');
  expect(idle.pending.size).toBe(1);
  idle.run();
  expect(mountSource).toHaveBeenCalledOnce();
  expect(mountSource).toHaveBeenCalledWith('bob');

  setUserId('carol');
  expect(disposeSource).toHaveBeenCalledWith('bob');
  unmount();
  expect(idle.pending.size).toBe(0);
  idle.run();
  expect(mountSource).toHaveBeenCalledOnce();
});
