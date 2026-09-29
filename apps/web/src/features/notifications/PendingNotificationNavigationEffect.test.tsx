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
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pendingNotificationNavigationId,
  setPendingNotificationNavigationId,
} from './notification-navigation-intent';
import type { NotificationSource } from './notification-source';
import { usePendingNotificationNavigationEffect } from './PendingNotificationNavigationEffect';

describe('usePendingNotificationNavigationEffect', () => {
  let dispose: VoidFunction | undefined;

  beforeEach(() => {
    mocks.openNotificationFromId.mockReset();
    mocks.openNotificationFromId.mockReturnValue({ match: vi.fn() });
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

  it('keeps a startup intent pending until the route host is ready', async () => {
    const manager = {} as SplitManager;
    const router = {} as SplitRouter<SplitId>;
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

    setGlobalSplitRouter(router);
    await Promise.resolve();

    expect(mocks.openNotificationFromId).toHaveBeenCalledExactlyOnceWith(
      'notification-1',
      manager,
      source
    );
    expect(pendingNotificationNavigationId()).toBeUndefined();
  });
});
