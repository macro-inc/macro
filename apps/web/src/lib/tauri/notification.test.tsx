import {
  PlatformNotificationProvider,
  type PlatformNotificationState,
  usePlatformNotificationState,
} from '@notifications/components/PlatformNotificationProvider';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ErrorBoundary } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notifications } from '../../features/settings/Notifications';
import { createTauriNotificationInterface } from './notification';

const native = vi.hoisted(() => ({
  osType: vi.fn(),
  invoke: vi.fn(),
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
  toastFailure: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/plugin-os', () => ({ type: native.osType }));
vi.mock('@tauri-apps/plugin-notification', () => native);
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: native.toastFailure },
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => false,
}));
vi.mock('@queries/notification/type-preferences', () => ({
  useNotificationTypePreferencesQuery: () => ({
    isPending: false,
    isError: false,
    data: { disabled_types: [] },
  }),
  useSetNotificationTypeEnabledMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@queries/notification/unsubscribes', () => ({
  useMutedEntitiesQuery: () => ({
    isPending: false,
    isError: false,
    data: [],
  }),
  useUnmuteItemMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@notifications/SnoozeNotificationsDialog', () => ({
  openSnoozeNotifications: vi.fn(),
}));
vi.mock('../../features/settings/MutedItemRow', () => ({
  MutedItemRow: () => null,
}));

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  native.osType.mockReturnValue('windows');
  native.invoke.mockResolvedValue('granted');
  native.isPermissionGranted.mockResolvedValue(true);
  native.requestPermission.mockResolvedValue('granted');
});

describe('macOS notification authorization', () => {
  beforeEach(() => {
    native.osType.mockReturnValue('macos');
    vi.stubGlobal('__TAURI_INTERNALS__', {});
  });

  it('directs denied macOS permission to System Settings without requesting it again', async () => {
    native.invoke.mockImplementation(async (command: string) => {
      if (command === 'request_macos_notification_permission') {
        throw new Error('macOS cannot prompt again after denial');
      }
      return 'denied';
    });
    const { state } = mount(true);
    await vi.waitFor(() => expect(state.permission()).toBe('denied'));
    const control = screen.getByRole('switch', {
      name: 'Desktop notifications',
    }) as HTMLInputElement;

    fireEvent.click(control);
    await vi.waitFor(() =>
      expect(native.toastFailure).toHaveBeenCalledWith(
        'Open System Settings → Notifications → Macro and turn on Allow notifications.'
      )
    );

    expect(control.checked).toBe(false);
    expect(control.disabled).toBe(false);
    expect(native.invoke).not.toHaveBeenCalledWith(
      'request_macos_notification_permission'
    );
    expect(native.requestPermission).not.toHaveBeenCalled();
    expect(await state.showNotification({ title: 'New message' })).toBe(
      'not-granted'
    );
    expect(native.sendNotification).not.toHaveBeenCalled();
  });

  it('keeps the setting off when macOS denies permission despite the plugin reporting granted', async () => {
    native.invoke.mockResolvedValue('denied');
    const { state } = mount(true);
    await vi.waitFor(() => expect(state.permission()).toBe('denied'));

    const control = screen.getByRole('switch', {
      name: 'Desktop notifications',
    }) as HTMLInputElement;
    expect(control.checked).toBe(false);
    expect(await state.showNotification({ title: 'New message' })).toBe(
      'not-granted'
    );
    expect(native.isPermissionGranted).not.toHaveBeenCalled();
    expect(native.sendNotification).not.toHaveBeenCalled();
  });

  it('requests actual macOS authorization when enabled from Settings', async () => {
    let permission: NotificationPermission = 'default';
    native.invoke.mockImplementation(async (command: string) => {
      if (command === 'request_macos_notification_permission') {
        permission = 'granted';
      }
      return permission;
    });
    const { state } = mount(true);
    await vi.waitFor(() => expect(state.permission()).toBe('default'));
    expect(native.invoke).not.toHaveBeenCalledWith(
      'request_macos_notification_permission'
    );

    const control = screen.getByRole('switch', {
      name: 'Desktop notifications',
    }) as HTMLInputElement;
    fireEvent.click(control);
    await vi.waitFor(() => expect(control.checked).toBe(true));

    expect(native.invoke).toHaveBeenCalledWith(
      'request_macos_notification_permission'
    );
    expect(native.requestPermission).not.toHaveBeenCalled();
    await state.showNotification({ title: 'New message' });
    expect(native.sendNotification).toHaveBeenCalledWith('New message');
  });

  it('checks macOS again before dispatch when authorization changes', async () => {
    const { state } = mount();
    await vi.waitFor(() => expect(state.permission()).toBe('granted'));
    native.invoke.mockResolvedValue('denied');

    expect(await state.showNotification({ title: 'New message' })).toBe(
      'not-granted'
    );
    expect(native.sendNotification).not.toHaveBeenCalled();
  });

  it('does not fall back to a false grant when the macOS permission query fails', async () => {
    native.invoke.mockRejectedValue(new Error('Permission query failed'));
    const { state } = mount(true);
    await vi.waitFor(() => expect(state.permission()).toBe('denied'));

    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Desktop notifications',
      })
    );
    await vi.waitFor(() =>
      expect(native.toastFailure).toHaveBeenCalledWith(
        'Could not update notifications. Try again.'
      )
    );
    expect(native.isPermissionGranted).not.toHaveBeenCalled();
    expect(native.sendNotification).not.toHaveBeenCalled();
  });

  it('handles a failed macOS authorization request without exposing native details in the toast', async () => {
    const error =
      'macOS notification authorization failed (UNErrorDomain 1): Notifications are not allowed for this application';
    native.invoke.mockImplementation(async (command: string) => {
      if (command === 'request_macos_notification_permission') throw error;
      return 'default';
    });
    const { state } = mount(true);
    await vi.waitFor(() => expect(state.permission()).toBe('default'));
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Desktop notifications',
      })
    );

    await vi.waitFor(() =>
      expect(native.toastFailure).toHaveBeenCalledWith(
        'Could not update notifications. Try again.'
      )
    );
    expect(native.sendNotification).not.toHaveBeenCalled();
    expect(screen.queryByText('Notification settings crashed')).toBeNull();
  });

  it('preserves delivery for older native builds receiving an OTA frontend update', async () => {
    native.invoke.mockRejectedValue(
      'Command get_macos_notification_permission not found'
    );
    const { state } = mount();
    await vi.waitFor(() => expect(state.permission()).toBe('granted'));

    await state.showNotification({ title: 'New message' });
    expect(native.sendNotification).toHaveBeenCalledWith('New message');
    expect(native.invoke).toHaveBeenCalledTimes(1);
  });

  it('refreshes the switch after returning from macOS System Settings', async () => {
    native.invoke.mockResolvedValue('denied');
    const { state } = mount(true);
    await vi.waitFor(() => expect(state.permission()).toBe('denied'));
    const control = screen.getByRole('switch', {
      name: 'Desktop notifications',
    }) as HTMLInputElement;

    native.invoke.mockResolvedValue('granted');
    fireEvent.focus(window);
    await vi.waitFor(() => expect(control.checked).toBe(true));

    native.invoke.mockResolvedValue('denied');
    fireEvent.focus(window);
    await vi.waitFor(() => expect(control.checked).toBe(false));
    expect(native.invoke).not.toHaveBeenCalledWith(
      'request_macos_notification_permission'
    );
  });

  it('recovers from a system permission grant before the next background delivery', async () => {
    native.invoke.mockResolvedValue('denied');
    const { state } = mount();
    await vi.waitFor(() => expect(state.permission()).toBe('denied'));

    native.invoke.mockResolvedValue('granted');
    await state.showNotification({ title: 'New message' });

    expect(native.sendNotification).toHaveBeenCalledWith('New message');
    expect(state.permission()).toBe('granted');
  });

  it('preserves opt-out while refreshing a previously denied system permission', async () => {
    native.invoke.mockResolvedValue('denied');
    const { state } = mount();
    await vi.waitFor(() => expect(state.permission()).toBe('denied'));
    let resolvePermission!: (permission: NotificationPermission) => void;
    native.invoke.mockImplementationOnce(
      () =>
        new Promise<NotificationPermission>((resolve) => {
          resolvePermission = resolve;
        })
    );

    const delivery = state.showNotification({ title: 'New message' });
    await state.unregisterNotification();
    resolvePermission('granted');

    expect(await delivery).toBe('disabled-in-ui');
    expect(native.sendNotification).not.toHaveBeenCalled();
  });

  it('preserves opt-out during an in-flight macOS permission check', async () => {
    const { state } = mount();
    await vi.waitFor(() => expect(state.permission()).toBe('granted'));
    let resolvePermission!: (permission: NotificationPermission) => void;
    native.invoke.mockImplementationOnce(
      () =>
        new Promise<NotificationPermission>((resolve) => {
          resolvePermission = resolve;
        })
    );

    const delivery = state.showNotification({ title: 'New message' });
    await state.unregisterNotification();
    resolvePermission('granted');
    expect(await delivery).toBe('not-granted');
    expect(native.sendNotification).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(showSetting = false) {
  let state!: PlatformNotificationState;
  function Consumer() {
    const value = usePlatformNotificationState();
    if (value === 'not-supported') {
      throw new Error('Expected native notification support');
    }
    state = value;
    return null;
  }

  const view = render(() => (
    <ErrorBoundary fallback={<div>Notification settings crashed</div>}>
      <PlatformNotificationProvider
        overrideDefault={createTauriNotificationInterface}
      >
        <Consumer />
        {showSetting && <Notifications />}
      </PlatformNotificationProvider>
    </ErrorBoundary>
  ));
  return { state, unmount: view.unmount };
}

describe('desktop notification preference', () => {
  it('sends native notifications when enabled', async () => {
    const { state } = mount();
    await vi.waitFor(() => expect(state.permission()).toBe('granted'));

    await state.showNotification({
      title: 'New message',
      options: { body: 'Hello', tag: 'message-1' },
    });

    expect(native.sendNotification).toHaveBeenCalledWith({
      title: 'New message',
      body: 'Hello',
      icon: undefined,
      extra: { tag: 'message-1' },
    });
  });

  it('honors a persisted opt-out before attempting native delivery', async () => {
    localStorage.setItem(
      'notification-manually-disabled',
      JSON.stringify('disabled-in-ui')
    );
    const { state } = mount();

    expect(await state.showNotification({ title: 'New message' })).toBe(
      'disabled-in-ui'
    );
    expect(native.isPermissionGranted).not.toHaveBeenCalled();
    expect(native.sendNotification).not.toHaveBeenCalled();
  });

  it('keeps notifications disabled after the provider reloads', async () => {
    const first = mount();
    await vi.waitFor(() => expect(first.state.permission()).toBe('granted'));
    await first.state.unregisterNotification();
    first.unmount();

    const second = mount();
    expect(await second.state.showNotification({ title: 'New message' })).toBe(
      'disabled-in-ui'
    );
    expect(native.sendNotification).not.toHaveBeenCalled();
  });

  it('suppresses a pending notification when disabled during the native permission check', async () => {
    const { state } = mount();
    await vi.waitFor(() => expect(state.permission()).toBe('granted'));
    let resolvePermission!: (granted: boolean) => void;
    native.isPermissionGranted.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePermission = resolve;
        })
    );

    const delivery = state.showNotification({ title: 'New message' });
    await state.unregisterNotification();
    resolvePermission(true);

    expect(await delivery).toBe('not-granted');
    expect(native.sendNotification).not.toHaveBeenCalled();
  });

  it('resumes native delivery when re-enabled', async () => {
    localStorage.setItem(
      'notification-manually-disabled',
      JSON.stringify('disabled-in-ui')
    );
    const { state } = mount();

    expect(await state.requestPermission()).toBe('granted');
    await state.showNotification({ title: 'New message' });

    expect(native.sendNotification).toHaveBeenCalledWith('New message');
    expect(localStorage.getItem('notification-manually-disabled')).toBe(
      JSON.stringify('allowed')
    );
  });

  it('does not send when native permission is denied', async () => {
    const { state } = mount();
    await vi.waitFor(() => expect(state.permission()).toBe('granted'));
    native.isPermissionGranted.mockResolvedValue(false);

    expect(await state.showNotification({ title: 'New message' })).toBe(
      'not-granted'
    );
    expect(native.sendNotification).not.toHaveBeenCalled();
  });

  it('keeps the setting usable when the initial native permission read fails', async () => {
    native.isPermissionGranted.mockRejectedValue(
      new Error('Native bridge unavailable')
    );
    const { state } = mount(true);
    await vi.waitFor(() => expect(state.permission()).toBe('denied'));

    const control = screen.getByRole('switch', {
      name: 'Desktop notifications',
    }) as HTMLInputElement;
    expect(control.checked).toBe(false);
    expect(control.disabled).toBe(false);
    expect(screen.queryByText('Notification settings crashed')).toBeNull();
    expect(await state.showNotification({ title: 'New message' })).toBe(
      'not-granted'
    );
    expect(native.sendNotification).not.toHaveBeenCalled();
  });

  it('reports a native read error and allows retrying enable from Settings', async () => {
    localStorage.setItem(
      'notification-manually-disabled',
      JSON.stringify('disabled-in-ui')
    );
    native.isPermissionGranted.mockRejectedValue(
      new Error('Native bridge unavailable')
    );
    mount(true);
    const control = screen.getByRole('switch', {
      name: 'Desktop notifications',
    }) as HTMLInputElement;

    fireEvent.click(control);
    await vi.waitFor(() =>
      expect(native.toastFailure).toHaveBeenCalledWith(
        'Could not update notifications. Try again.'
      )
    );
    expect(control.checked).toBe(false);
    expect(control.disabled).toBe(false);
    expect(screen.queryByText('Notification settings crashed')).toBeNull();

    native.isPermissionGranted.mockResolvedValue(true);
    fireEvent.click(control);
    await vi.waitFor(() => expect(control.checked).toBe(true));
    expect(native.toastFailure).toHaveBeenCalledTimes(1);
  });

  it('toggles native delivery and persists the choice through the existing Settings page', async () => {
    const first = mount(true);
    const control = screen.getByRole('switch', {
      name: 'Desktop notifications',
    }) as HTMLInputElement;
    await vi.waitFor(() => expect(control.checked).toBe(true));
    fireEvent.click(control);
    await vi.waitFor(() => expect(control.checked).toBe(false));
    expect(await first.state.showNotification({ title: 'New message' })).toBe(
      'disabled-in-ui'
    );
    first.unmount();

    const second = mount(true);
    const restoredControl = screen.getByRole('switch', {
      name: 'Desktop notifications',
    }) as HTMLInputElement;
    await vi.waitFor(() =>
      expect(second.state.permission()).toBe('disabled-in-ui')
    );
    expect(restoredControl.checked).toBe(false);
    expect(native.sendNotification).not.toHaveBeenCalled();

    fireEvent.click(restoredControl);
    await vi.waitFor(() => expect(restoredControl.checked).toBe(true));
    await second.state.showNotification({ title: 'New message' });
    expect(native.sendNotification).toHaveBeenCalledWith('New message');
  });

  it('disables the Settings switch while a permission request is pending', async () => {
    localStorage.setItem(
      'notification-manually-disabled',
      JSON.stringify('disabled-in-ui')
    );
    let grantPermission!: (permission: boolean) => void;
    const permission = new Promise<boolean>((resolve) => {
      grantPermission = resolve;
    });
    native.isPermissionGranted.mockReturnValue(permission);
    mount(true);
    const control = screen.getByRole('switch', {
      name: 'Desktop notifications',
    }) as HTMLInputElement;

    fireEvent.click(control);
    expect(control.disabled).toBe(true);
    const pendingReads = native.isPermissionGranted.mock.calls.length;
    fireEvent.click(control);
    expect(native.isPermissionGranted).toHaveBeenCalledTimes(pendingReads);

    grantPermission(true);
    await vi.waitFor(() => expect(control.disabled).toBe(false));
    expect(control.checked).toBe(true);
  });

  it('reports denied permission from the Settings page without enabling delivery', async () => {
    native.isPermissionGranted.mockResolvedValue(false);
    native.requestPermission.mockResolvedValue('denied');
    const { state } = mount(true);
    await vi.waitFor(() => expect(state.permission()).toBe('denied'));
    const control = screen.getByRole('switch', {
      name: 'Desktop notifications',
    }) as HTMLInputElement;

    fireEvent.click(control);
    await vi.waitFor(() =>
      expect(native.toastFailure).toHaveBeenCalledWith(
        'Allow notification permissions, then try again.'
      )
    );
    expect(control.checked).toBe(false);
    expect(control.disabled).toBe(false);
    expect(native.requestPermission).toHaveBeenCalledOnce();
    expect(native.sendNotification).not.toHaveBeenCalled();
  });
});
