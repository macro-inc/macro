const mocks = vi.hoisted(() => ({
  openNotificationFromId: vi.fn(),
}));

vi.mock('@notifications', async () => ({
  ...(await import('./notification-navigation-intent')),
  openNotificationFromId: mocks.openNotificationFromId,
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));

import type { SplitRouter } from '@app/lib/split-router';
import {
  setGlobalSplitManager,
  setGlobalSplitRouter,
} from '@app/signal/splitLayout';
import type {
  SplitId,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pendingNotificationNavigationId,
  setPendingNotificationNavigationId,
} from './notification-navigation-intent';
import type { NotificationSource } from './notification-source';
import { usePendingNotificationNavigationEffect } from './PendingNotificationNavigationEffect';

function routerHarness(initiallyReady = false) {
  let ready = initiallyReady;
  const listeners = new Set<VoidFunction>();
  const router = {
    isReady: () => ready,
    entry: () => (ready ? {} : undefined),
    subscribe: (listener: VoidFunction) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as SplitRouter<SplitId>;
  return {
    router,
    markReady: () => {
      ready = true;
      for (const listener of listeners) listener();
    },
  };
}

describe('usePendingNotificationNavigationEffect', () => {
  let dispose: VoidFunction | undefined;
  let completeOpen: VoidFunction | undefined;

  beforeEach(() => {
    mocks.openNotificationFromId.mockReset();
    completeOpen = undefined;
    mocks.openNotificationFromId.mockReturnValue({
      match: (onSuccess: VoidFunction) => {
        completeOpen = onSuccess;
      },
    });
    setPendingNotificationNavigationId(undefined);
    setGlobalSplitManager(undefined);
    setGlobalSplitRouter(undefined);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    setPendingNotificationNavigationId(undefined);
    setGlobalSplitManager(undefined);
    setGlobalSplitRouter(undefined);
  });

  it('keeps a startup intent pending until route navigation is accepted', async () => {
    const [activeSplitId, setActiveSplitId] = createSignal<SplitId>();
    const manager = { activeSplitId } as unknown as SplitManager;
    const router = routerHarness();
    const source = {} as NotificationSource;
    dispose = createRoot((rootDispose) => {
      usePendingNotificationNavigationEffect(source);
      return rootDispose;
    });

    setGlobalSplitManager(manager);
    setPendingNotificationNavigationId('notification-1');
    await Promise.resolve();

    expect(mocks.openNotificationFromId).not.toHaveBeenCalled();
    expect(pendingNotificationNavigationId()).toBe('notification-1');

    setGlobalSplitRouter(router.router);
    await Promise.resolve();

    expect(mocks.openNotificationFromId).not.toHaveBeenCalled();
    expect(pendingNotificationNavigationId()).toBe('notification-1');

    router.markReady();
    await Promise.resolve();

    expect(mocks.openNotificationFromId).not.toHaveBeenCalled();
    expect(pendingNotificationNavigationId()).toBe('notification-1');

    setActiveSplitId('source' as SplitId);
    await Promise.resolve();

    expect(mocks.openNotificationFromId).toHaveBeenCalledExactlyOnceWith(
      'notification-1',
      manager,
      source,
      { canOpen: expect.any(Function) }
    );
    expect(pendingNotificationNavigationId()).toBe('notification-1');

    setActiveSplitId('new-source' as SplitId);
    await Promise.resolve();
    expect(mocks.openNotificationFromId).toHaveBeenCalledTimes(1);

    completeOpen?.();
    expect(pendingNotificationNavigationId()).toBeUndefined();
  });

  it('does not clear an in-flight intent across a route-host transition', async () => {
    const sourceId = 'source' as SplitId;
    const manager = {
      activeSplitId: () => sourceId,
    } as unknown as SplitManager;
    const firstRouter = routerHarness(true).router;
    const secondRouter = routerHarness(true).router;
    const source = {} as NotificationSource;
    const completions: VoidFunction[] = [];
    mocks.openNotificationFromId.mockImplementation(() => ({
      match: (onSuccess: VoidFunction) => {
        completions.push(onSuccess);
      },
    }));
    dispose = createRoot((rootDispose) => {
      usePendingNotificationNavigationEffect(source);
      return rootDispose;
    });

    setGlobalSplitManager(manager);
    setGlobalSplitRouter(firstRouter);
    setPendingNotificationNavigationId('notification-1');
    await Promise.resolve();
    expect(completions).toHaveLength(1);

    setGlobalSplitRouter(undefined);
    completions[0]?.();
    expect(pendingNotificationNavigationId()).toBe('notification-1');

    setGlobalSplitRouter(secondRouter);
    await Promise.resolve();
    expect(completions).toHaveLength(2);
    completions[1]?.();
    expect(pendingNotificationNavigationId()).toBeUndefined();
  });

  it('keeps an in-flight intent across account teardown', async () => {
    const sourceId = 'source' as SplitId;
    const firstManager = {
      activeSplitId: () => sourceId,
    } as unknown as SplitManager;
    const secondManager = {
      activeSplitId: () => sourceId,
    } as unknown as SplitManager;
    const firstRouter = routerHarness(true).router;
    const secondRouter = routerHarness(true).router;
    const source = {} as NotificationSource;
    const completions: VoidFunction[] = [];
    mocks.openNotificationFromId.mockImplementation(() => ({
      match: (onSuccess: VoidFunction) => {
        completions.push(onSuccess);
      },
    }));
    dispose = createRoot((rootDispose) => {
      usePendingNotificationNavigationEffect(source);
      return rootDispose;
    });

    setGlobalSplitManager(firstManager);
    setGlobalSplitRouter(firstRouter);
    setPendingNotificationNavigationId('notification-1');
    await Promise.resolve();
    expect(completions).toHaveLength(1);

    setGlobalSplitManager(undefined);
    setGlobalSplitRouter(undefined);
    completions[0]?.();
    expect(pendingNotificationNavigationId()).toBe('notification-1');

    setGlobalSplitManager(secondManager);
    setGlobalSplitRouter(secondRouter);
    await Promise.resolve();
    expect(completions).toHaveLength(2);
    completions[1]?.();
    expect(pendingNotificationNavigationId()).toBeUndefined();
  });
});
