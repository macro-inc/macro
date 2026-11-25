import {
  holdAutomaticReload,
  resetReloadForNewerBuildForTests,
} from '@core/util/reloadForNewerBuild';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BundleUpdateStatus, MaybeTauriProvider } from './TauriProvider';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'ios' }));
vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/platform')>()),
  isTauri: () => true,
  isPlatform: (target: string | string[]) =>
    Array.isArray(target) ? target.includes('ios') : target === 'ios',
  getNativeMobilePlatform: () => 'ios',
}));
vi.mock('@channel/Call/native-call-state', () => ({
  NativeCallProvider: (props: { children: unknown }) => props.children,
}));
vi.mock('@channel/Call/use-callkit', () => ({
  useCallKitSetup: () => {},
}));
vi.mock('@core/mobile/androidBack', () => ({
  useAndroidBack: () => {},
}));
vi.mock('@core/mobile/androidWindowInsets', () => ({
  useAndroidWindowInsets: () => {},
}));
vi.mock('@core/mobile/NativeAppUpdateRequiredDialog', () => ({
  NativeAppUpdateRequiredDialog: () => null,
}));
vi.mock('@core/mobile/nativeUpdateRequired', () => ({
  nativeUpdateRequired: () => undefined,
}));
vi.mock('@queries/client', () => ({
  queryPersistence: { flush: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('./native-updates', () => ({
  createNativeUpdates: () => ({
    status: () => ({ status: 'Disabled' }),
    preparing: () => false,
    restart: vi.fn(),
    registerPreparation: () => () => {},
  }),
  nativeUpdateDescription: () => undefined,
}));
vi.mock('./PushNotification', () => ({
  MaybePushNotificationRegistration: (props: { children: unknown }) =>
    props.children,
}));
vi.mock('./ShareTargetProvider', () => ({
  ShareTargetProvider: (props: { children: unknown }) => props.children,
}));
vi.mock('./WaitingForWifiUpdateDialog', () => ({
  createWaitingForWifiPrompt: () => ({
    observe: vi.fn(),
    yieldToNativeUpdate: vi.fn(),
  }),
  WaitingForWifiUpdateDialog: () => null,
}));
vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@macro-inc/observability')>()),
  Telemetry: { error: vi.fn() },
}));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/Dialog')),
  ...(await import('@app/components/ui/components/Surface')),
}));

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('TauriProvider hidden bundle update gating', () => {
  let statusListener:
    | ((event: { payload: BundleUpdateStatus }) => void)
    | undefined;

  beforeEach(() => {
    statusListener = undefined;
    resetReloadForNewerBuildForTests();
    vi.mocked(listen).mockImplementation(async (event, cb) => {
      if (event === 'bundle-update-status') {
        statusListener = cb as (event: { payload: BundleUpdateStatus }) => void;
      }
      return () => {};
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'get_bundle_update_status') {
        return { status: 'Idle' } satisfies BundleUpdateStatus;
      }
      return false;
    });
    setDocumentHidden(false);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetReloadForNewerBuildForTests();
    setDocumentHidden(false);
  });

  it('does not invoke perform_update on hide when no update is ready to apply', async () => {
    render(() => (
      <MaybeTauriProvider>
        <div>app</div>
      </MaybeTauriProvider>
    ));
    await waitFor(() => expect(statusListener).toBeDefined());

    for (const status of [
      { status: 'Idle' },
      { status: 'CheckingForUpdate' },
      { status: 'NoUpdateNeeded' },
      { status: 'Downloading', data: { progress: 50 } },
      { status: 'Unzipping', data: { progress: 50 } },
      { status: 'WaitingForWifi' },
      {
        status: 'NativeUpdateRequired',
        data: { bundleBuild: 2, minNativeBuild: 300 },
      },
      { status: 'Error', data: { message: 'network' } },
    ] satisfies BundleUpdateStatus[]) {
      statusListener?.({ payload: status });
      setDocumentHidden(true);
      setDocumentHidden(false);
    }

    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === 'perform_update')
    ).toHaveLength(0);
  });

  it('skips perform_update on hide while the user is editing text', async () => {
    render(() => (
      <MaybeTauriProvider>
        <input aria-label="composer" value="draft in progress" />
      </MaybeTauriProvider>
    ));
    await waitFor(() => expect(statusListener).toBeDefined());
    statusListener?.({ payload: { status: 'Completed' } });

    const input = document.querySelector('input')!;
    input.focus();
    setDocumentHidden(true);

    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === 'perform_update')
    ).toHaveLength(0);

    input.blur();
    setDocumentHidden(false);
    setDocumentHidden(true);

    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === 'perform_update')
    ).toHaveLength(1);
  });

  it('respects automatic reload holds and applies Completed and ClearRequired updates when idle', async () => {
    render(() => (
      <MaybeTauriProvider>
        <div>app</div>
      </MaybeTauriProvider>
    ));
    await waitFor(() => expect(statusListener).toBeDefined());

    const releaseHold = holdAutomaticReload();
    statusListener?.({ payload: { status: 'Completed' } });
    setDocumentHidden(true);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === 'perform_update')
    ).toHaveLength(0);

    releaseHold();
    setDocumentHidden(false);
    setDocumentHidden(true);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === 'perform_update')
    ).toHaveLength(1);

    statusListener?.({
      payload: { status: 'ClearRequired', data: { reason: 'revoked' } },
    });
    setDocumentHidden(false);
    setDocumentHidden(true);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === 'perform_update')
    ).toHaveLength(2);
  });

  it('does not let a late initial status snapshot overwrite a newer bundle-update-status event', async () => {
    let resolveInitialStatus:
      | ((status: BundleUpdateStatus) => void)
      | undefined;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'get_bundle_update_status') {
        return new Promise<BundleUpdateStatus>((resolve) => {
          resolveInitialStatus = resolve;
        });
      }
      return Promise.resolve(false);
    });

    render(() => (
      <MaybeTauriProvider>
        <div>app</div>
      </MaybeTauriProvider>
    ));
    await waitFor(() => {
      expect(statusListener).toBeDefined();
      expect(resolveInitialStatus).toBeDefined();
    });

    // A live Completed event arrives before the initial snapshot resolves with Idle.
    statusListener?.({ payload: { status: 'Completed' } });
    resolveInitialStatus?.({ status: 'Idle' });
    await Promise.resolve();
    await Promise.resolve();

    setDocumentHidden(true);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === 'perform_update')
    ).toHaveLength(1);
  });
});
