import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaybePushNotificationRegistration } from './PushNotification';

const registration = vi.hoisted(() => ({
  os: 'android',
  version: '16',
  sync: undefined as (() => Promise<void>) | undefined,
  register: vi.fn(async () => ({ isErr: () => false })),
}));
vi.mock('@core/constant/featureFlags', () => ({ ENABLE_CALLKIT: true }));
vi.mock('@core/util/platform', () => ({
  isTauri: () => true,
  isPlatform: (os: string) => registration.os === os,
}));
vi.mock('@tauri-apps/plugin-os', () => ({
  version: () => registration.version,
}));
vi.mock('@core/util/cookies', () => ({ hasLoginCookie: () => true }));
vi.mock('@core/auth/push-registration-lifecycle', () => ({
  registerPushRegistrationLifecycle: (hooks: {
    syncRegistration: () => Promise<void>;
  }) => {
    registration.sync = hooks.syncRegistration;
    return () => {};
  },
  syncPushRegistrations: async () => {},
}));
vi.mock('@queries/notification/device-registration', () => ({
  fetchPushRecipient: async () => 'macro|test@example.com',
  registerPushDevice: registration.register,
  unregisterPushDevice: async () => ({ isErr: () => false }),
}));
vi.mock('@solid-primitives/storage', () => ({
  makePersisted: (signal: unknown) => signal,
}));
vi.mock('@tauri-apps/plugin-notification', () => ({
  removeAllActive: async () => {},
}));
vi.mock('@notifications', () => ({
  PlatformNotificationProvider: () => null,
  triggerNotificationNavigation: vi.fn(),
}));
vi.mock('./TauriProvider', () => ({
  useExpectTauri: () => ({ os: registration.os }),
}));
vi.mock('./notification', () => ({
  createTauriNotificationInterface: vi.fn(),
}));
vi.mock('./push-api', () => ({
  createPushApi: () => ({
    checkPermissions: async () => ({ status: 'granted' }),
    register: async () => ({ token: 'test-device-token' }),
    configureRecipient: async () => {},
    watch: async () => {},
    unwatch: async () => {},
  }),
}));

let dispose: (() => void) | undefined;
beforeEach(() => {
  registration.os = 'android';
  registration.version = '16';
  registration.sync = undefined;
  registration.register.mockClear();
  delete window.__MACRO_ANDROID_CALL_KIT__;
});
afterEach(() => {
  dispose?.();
  delete window.__MACRO_ANDROID_CALL_KIT__;
});

describe('push registration native-call capability', () => {
  it.each([
    { os: 'android', version: '16', binary: true, expected: true },
    { os: 'android', version: '16', binary: false, expected: false },
    { os: 'android', version: '7.1.2', binary: true, expected: false },
    { os: 'ios', version: '18', binary: false, expected: undefined },
  ])(
    'registers $os $version with binary capability $binary',
    async ({ os, version, binary, expected }) => {
      registration.os = os;
      registration.version = version;
      if (binary) window.__MACRO_ANDROID_CALL_KIT__ = true;
      createRoot((cleanup) => {
        dispose = cleanup;
        MaybePushNotificationRegistration({ children: null });
      });
      expect(registration.sync).toBeDefined();
      await registration.sync!();
      expect(registration.register).toHaveBeenCalledExactlyOnceWith({
        deviceType: os,
        token: 'test-device-token',
        ...(expected === undefined ? {} : { nativeCallCapable: expected }),
      });
    }
  );
});
