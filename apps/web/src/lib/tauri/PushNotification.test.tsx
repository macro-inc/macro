import type { PushRegistrationLifecycle } from '@core/auth/push-registration-lifecycle';
import type { PlatformNotificationInterface } from '@notifications';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushEvent } from './push-api';

const mock = vi.hoisted(() => ({
  loggedIn: true,
  lifecycle: undefined as PushRegistrationLifecycle | undefined,
  watcher: undefined as ((event: PushEvent) => void) | undefined,
  check: vi.fn(),
  request: vi.fn(),
  register: vi.fn(),
  configure: vi.fn(),
  unwatch: vi.fn(),
  registerDevice: vi.fn(),
  unregisterDevice: vi.fn(),
  recipient: vi.fn(),
  navigate: vi.fn(),
  acknowledge: vi.fn(),
  localShow: vi.fn(),
  notifications: undefined as PlatformNotificationInterface | undefined,
}));

vi.mock('@core/util/cookies', () => ({ hasLoginCookie: () => mock.loggedIn }));
vi.mock('@core/auth/push-registration-lifecycle', () => ({
  registerPushRegistrationLifecycle: (lifecycle: PushRegistrationLifecycle) => {
    mock.lifecycle = lifecycle;
    return () => {};
  },
  syncPushRegistrations: async () => {
    await mock.lifecycle?.syncRegistration();
  },
}));
vi.mock('@queries/notification/device-registration', () => ({
  fetchPushRecipient: mock.recipient,
  registerPushDevice: mock.registerDevice,
  unregisterPushDevice: mock.unregisterDevice,
}));
vi.mock('@notifications', () => ({
  PlatformNotificationProvider: (props: {
    children: unknown;
    overrideDefault: (
      disabled: () => Promise<void>
    ) => PlatformNotificationInterface;
  }) => {
    mock.notifications = props.overrideDefault(async () => {});
    return props.children;
  },
  triggerNotificationNavigation: mock.navigate,
}));
vi.mock('@tauri-apps/plugin-notification', () => ({
  removeAllActive: vi.fn(async () => {}),
}));
vi.mock('./notification', () => ({
  createTauriNotificationInterface: () => ({
    showNotification: mock.localShow,
    requestPermission: async () => 'granted',
    getCurrentPermission: async () => 'granted',
    unregisterNotifications: async () => {},
  }),
}));
vi.mock('./TauriProvider', () => ({
  useExpectTauri: () => ({ os: 'android' }),
}));
vi.mock('./push-api', () => ({
  createPushApi: () => ({
    checkPermissions: mock.check,
    requestPermissions: mock.request,
    register: mock.register,
    configureRecipient: mock.configure,
    unwatch: mock.unwatch,
    acknowledge: mock.acknowledge,
    watch: async (callback: (event: PushEvent) => void) => {
      mock.watcher = callback;
    },
  }),
}));

import { MaybePushNotificationRegistration } from './PushNotification';

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mock.loggedIn = true;
  mock.watcher = undefined;
  mock.notifications = undefined;
  mock.check.mockResolvedValue({ status: 'denied' });
  mock.register.mockResolvedValue({ success: true, token: 'test-token' });
  mock.configure.mockResolvedValue(undefined);
  mock.unwatch.mockResolvedValue(undefined);
  mock.recipient.mockResolvedValue('macro|alice@example.com');
  mock.registerDevice.mockResolvedValue({ isErr: () => false });
  mock.unregisterDevice.mockResolvedValue({ isErr: () => false });
});
afterEach(cleanup);

async function mount() {
  render(() => (
    <MaybePushNotificationRegistration>
      <div />
    </MaybePushNotificationRegistration>
  ));
  await vi.waitFor(() => expect(mock.watcher).toBeDefined());
  // Let the launch sync (permission denied -> receiver disarmed) finish
  // before starting a new action.
  await vi.waitFor(() => expect(mock.configure).toHaveBeenCalledWith(null));
  expect(mock.check).toHaveBeenCalledTimes(1);
  expect(mock.configure).toHaveBeenCalledTimes(1);
  mock.configure.mockClear();
}

describe('Android push lifecycle', () => {
  it('listens before registration and navigates only on taps', async () => {
    await mount();
    expect(mock.registerDevice).not.toHaveBeenCalled();
    mock.watcher?.({
      type: 'BACKGROUND_DELIVERY',
      payload: { notificationId: 'id' },
    });
    expect(mock.navigate).not.toHaveBeenCalled();
    mock.watcher?.({
      type: 'BACKGROUND_TAP',
      payload: { notificationId: 'id' },
      deliveryId: 'delivery-id',
    });
    expect(mock.navigate).toHaveBeenCalledWith('id');
    expect(mock.acknowledge).toHaveBeenCalledWith('delivery-id');
  });

  it('binds the native receiver only after backend registration succeeds', async () => {
    await mount();
    mock.check.mockResolvedValue({ status: 'granted' });
    await mock.lifecycle?.syncRegistration();
    expect(mock.registerDevice).toHaveBeenCalledWith({
      deviceType: 'android',
      token: 'test-token',
    });
    expect(mock.configure).toHaveBeenCalledWith('macro|alice@example.com');
  });

  it('cannot re-enable the old recipient when registration finishes after logout', async () => {
    await mount();
    mock.check.mockResolvedValue({ status: 'granted' });
    let complete!: (value: { isErr: () => boolean }) => void;
    mock.registerDevice.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const syncing = expect(mock.lifecycle!.syncRegistration()).rejects.toThrow(
      'push device registration did not complete'
    );
    await vi.waitFor(() => expect(mock.registerDevice).toHaveBeenCalled());
    await mock.lifecycle!.unregisterForLogout();
    mock.loggedIn = false;
    complete({ isErr: () => false });
    await syncing;
    expect(mock.configure.mock.calls).toEqual([[null]]);
  });

  it('disables native display when permission is revoked', async () => {
    await mount();
    mock.check.mockResolvedValue({ status: 'granted' });
    await mock.lifecycle?.syncRegistration();
    mock.configure.mockClear();
    mock.check.mockResolvedValue({ status: 'denied' });
    await mock.lifecycle?.syncRegistration();
    expect(mock.configure).toHaveBeenCalledWith(null);
  });

  it('suppresses websocket local notifications after remote push registration', async () => {
    await mount();
    mock.check.mockResolvedValue({ status: 'granted' });
    await mock.lifecycle?.syncRegistration();
    await mock.notifications!.showNotification({
      title: 'Duplicate message',
      options: { body: 'Body' },
    });
    expect(mock.localShow).not.toHaveBeenCalled();
  });
});
