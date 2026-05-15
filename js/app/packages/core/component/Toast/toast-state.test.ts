import { describe, expect, it, vi } from 'vitest';
import { ToastManager, ToastType, orderToastRecords } from './toast-state';

describe('ToastManager', () => {
  it('updates an existing toast when the same id is reused', () => {
    const manager = new ToastManager();

    const id = manager.show({
      kind: 'standard',
      id: 'shared-id',
      toastType: ToastType.SUCCESS,
      message: 'First',
    });

    manager.show({
      kind: 'standard',
      id: 'shared-id',
      toastType: ToastType.FAILURE,
      message: 'Second',
    });

    expect(id).toBe('shared-id');
    expect(manager.getActiveToasts()).toHaveLength(1);
    expect(manager.getActiveToasts()[0]).toMatchObject({
      id: 'shared-id',
      kind: 'standard',
      toastType: ToastType.FAILURE,
      message: 'Second',
    });
  });

  it('publishes dismiss events and removes dismissed toasts', () => {
    const manager = new ToastManager();
    const subscriber = vi.fn();

    manager.subscribe(subscriber);

    const id = manager.show({
      kind: 'standard',
      toastType: ToastType.SUCCESS,
      message: 'Saved',
    });

    manager.dismiss(id);

    expect(subscriber).toHaveBeenLastCalledWith({ id, dismiss: true });
    expect(manager.getActiveToasts()).toHaveLength(0);
  });
});

describe('orderToastRecords', () => {
  it('keeps stable toasts behind the regular stack', () => {
    const ordered = orderToastRecords([
      {
        id: 'stable',
        kind: 'standard',
        toastType: ToastType.LOADING,
        message: 'Uploading',
        dismissible: false,
        region: 'stable-toast',
        createdAt: 2,
      },
      {
        id: 'regular',
        kind: 'standard',
        toastType: ToastType.SUCCESS,
        message: 'Done',
        dismissible: true,
        region: 'toast-region',
        createdAt: 1,
      },
    ]);

    expect(ordered.map((toast) => toast.id)).toEqual(['regular', 'stable']);
  });
});
