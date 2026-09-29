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

import { setGlobalSplitManager } from '@app/signal/splitLayout';
import type {
  SplitEventWithType,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { batch, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pendingNotificationNavigationId,
  setPendingNotificationNavigationId,
} from './notification-navigation-intent';
import type { NotificationSource } from './notification-source';
import { usePendingNotificationNavigationEffect } from './PendingNotificationNavigationEffect';

type OpenAttempt = {
  canOpen: () => boolean;
  onApplied: VoidFunction;
  succeed: VoidFunction;
};

function managerHarness(initiallyReady = false) {
  const [ready, setReady] = createSignal(initiallyReady);
  const [version, setVersion] = createSignal(initiallyReady ? 1 : 0);
  const [event, setEvent] = createSignal<SplitEventWithType | undefined>(
    undefined,
    { equals: false }
  );
  const manager = {
    contentNavigationReady: ready,
    contentNavigationVersion: version,
    events: event,
  } as unknown as SplitManager;

  return {
    manager,
    bind: () => {
      batch(() => {
        setReady(true);
        setVersion((value) => value + 1);
      });
    },
    unbind: () => {
      batch(() => {
        setReady(false);
        setVersion((value) => value + 1);
      });
    },
    reconcile: () => setEvent({ type: 3 } as SplitEventWithType),
  };
}

describe('usePendingNotificationNavigationEffect', () => {
  let dispose: VoidFunction | undefined;
  let attempts: OpenAttempt[];

  beforeEach(() => {
    attempts = [];
    mocks.openNotificationFromId.mockReset();
    mocks.openNotificationFromId.mockImplementation(
      (
        _notificationId: string,
        _manager: SplitManager,
        _source: NotificationSource,
        options: Pick<OpenAttempt, 'canOpen' | 'onApplied'>
      ) => ({
        match: (onSuccess: VoidFunction) => {
          attempts.push({ ...options, succeed: onSuccess });
        },
      })
    );
    setPendingNotificationNavigationId(undefined);
    setGlobalSplitManager(undefined);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    setPendingNotificationNavigationId(undefined);
    setGlobalSplitManager(undefined);
  });

  function mount(source = {} as NotificationSource) {
    dispose = createRoot((rootDispose) => {
      usePendingNotificationNavigationEffect(source);
      return rootDispose;
    });
    return source;
  }

  it('keeps a startup intent pending until the native host applies it', async () => {
    const host = managerHarness();
    const source = mount();
    setGlobalSplitManager(host.manager);
    setPendingNotificationNavigationId('notification-1');
    await Promise.resolve();

    expect(mocks.openNotificationFromId).not.toHaveBeenCalled();
    expect(pendingNotificationNavigationId()).toBe('notification-1');

    host.bind();
    await Promise.resolve();

    expect(mocks.openNotificationFromId).toHaveBeenCalledExactlyOnceWith(
      'notification-1',
      host.manager,
      source,
      { canOpen: expect.any(Function), onApplied: expect.any(Function) }
    );
    expect(attempts[0]?.canOpen()).toBe(true);

    attempts[0]?.succeed();
    expect(pendingNotificationNavigationId()).toBe('notification-1');

    attempts[0]?.onApplied();
    expect(pendingNotificationNavigationId()).toBeUndefined();
  });

  it('retries a settled but aborted request after layout reconciliation', async () => {
    const host = managerHarness(true);
    mount();
    setGlobalSplitManager(host.manager);
    setPendingNotificationNavigationId('notification-1');
    await Promise.resolve();
    expect(attempts).toHaveLength(1);

    host.reconcile();
    await Promise.resolve();
    expect(attempts).toHaveLength(1);

    attempts[0]?.succeed();
    await Promise.resolve();
    expect(attempts).toHaveLength(2);

    attempts[0]?.onApplied();
    expect(pendingNotificationNavigationId()).toBe('notification-1');
    attempts[1]?.succeed();
    attempts[1]?.onApplied();
    expect(pendingNotificationNavigationId()).toBeUndefined();
  });

  it('invalidates an in-flight request when the route host is replaced', async () => {
    const host = managerHarness(true);
    mount();
    setGlobalSplitManager(host.manager);
    setPendingNotificationNavigationId('notification-1');
    await Promise.resolve();
    expect(attempts).toHaveLength(1);

    host.unbind();
    expect(attempts[0]?.canOpen()).toBe(false);
    host.bind();
    await Promise.resolve();
    expect(attempts).toHaveLength(2);

    attempts[0]?.succeed();
    attempts[0]?.onApplied();
    expect(pendingNotificationNavigationId()).toBe('notification-1');
    attempts[1]?.succeed();
    attempts[1]?.onApplied();
    expect(pendingNotificationNavigationId()).toBeUndefined();
  });

  it('keeps the intent across account teardown and ignores stale completion', async () => {
    const first = managerHarness(true);
    const second = managerHarness(true);
    mount();
    setGlobalSplitManager(first.manager);
    setPendingNotificationNavigationId('notification-1');
    await Promise.resolve();
    expect(attempts).toHaveLength(1);

    setGlobalSplitManager(undefined);
    attempts[0]?.succeed();
    attempts[0]?.onApplied();
    expect(pendingNotificationNavigationId()).toBe('notification-1');

    setGlobalSplitManager(second.manager);
    await Promise.resolve();
    expect(attempts).toHaveLength(2);
    attempts[1]?.succeed();
    attempts[1]?.onApplied();
    expect(pendingNotificationNavigationId()).toBeUndefined();
  });
});
