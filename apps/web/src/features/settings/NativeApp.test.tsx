/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeApp } from './NativeApp';

const host = vi.hoisted(() => ({ platform: 'ios', reviewAccount: false }));
const invoke = vi.hoisted(() => vi.fn());
const restartNativeUpdate = vi.hoisted(() => vi.fn());
const tauri = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/platform')>()),
  getPlatform: () => host.platform,
  isPlatform: (target: string) => target === host.platform,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: host.reviewAccount }),
}));
vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => Promise.resolve('2026.1119.1'),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@macro/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@macro/tauri')>()),
  useTauri: () => tauri.current,
}));

const BUILT = Date.UTC(2026, 10, 19, 12, 0);

function answerNativeCommands(source: 'embedded' | 'ota') {
  invoke.mockImplementation((command: string) => {
    if (command === 'get_bundle_debug_info') {
      return Promise.resolve({ bundleBuild: BUILT, source, nativeBuild: 342 });
    }
    if (command === 'get_native_build_time') return Promise.resolve(BUILT);
    return Promise.resolve();
  });
}

function mountWith(bundle: string, native = 'Disabled') {
  const [bundleUpdateStatus] = createSignal(
    bundle === 'UpdateFound'
      ? { status: bundle, data: { version: '2026.1120.1', notes: null } }
      : { status: bundle }
  );
  const [nativeUpdateStatus] = createSignal(
    native === 'Ready'
      ? { status: 'Ready', data: { version: '2026.1120.1' } }
      : { status: native }
  );
  tauri.current = {
    bundleUpdateStatus,
    nativeUpdateStatus,
    nativeUpdatePreparing: () => false,
    restartNativeUpdate,
  };
  render(() => <NativeApp />);
}

afterEach(() => {
  cleanup();
  host.platform = 'ios';
  host.reviewAccount = false;
  vi.clearAllMocks();
});

describe('NativeApp', () => {
  it('describes the installed iOS app and its bundle', async () => {
    answerNativeCommands('ota');
    mountWith('NoUpdateNeeded');

    expect(screen.getByRole('heading', { name: 'iOS App' })).toBeTruthy();
    expect(await screen.findByText('2026.1119.1')).toBeTruthy();
    expect(await screen.findByText('342')).toBeTruthy();
    expect(screen.getByText('Bundle date')).toBeTruthy();
    expect(screen.getByText('Up to date')).toBeTruthy();
  });

  it.each([
    { status: 'Idle', label: 'Check for updates', command: 'check_for_update' },
    { status: 'Error', label: 'Retry', command: 'check_for_update' },
    { status: 'Completed', label: 'Update', command: 'perform_update' },
    { status: 'ClearRequired', label: 'Reload', command: 'perform_update' },
  ])(
    'runs $command from $label while the update is $status',
    async ({ status, label, command }) => {
      answerNativeCommands('embedded');
      mountWith(status);

      fireEvent.click(await screen.findByRole('button', { name: label }));

      expect(invoke).toHaveBeenCalledWith(command);
    }
  );

  it.each([
    { status: 'UpdateFound', label: 'Download' },
    { status: 'WaitingForWifi', label: 'Download anyway' },
  ])('approves the download from $label', async ({ status, label }) => {
    answerNativeCommands('embedded');
    mountWith(status);

    fireEvent.click(await screen.findByRole('button', { name: label }));

    expect(invoke).toHaveBeenCalledWith('grant_bundle_update', {
      approved: true,
    });
  });

  it('leaves over-the-air updates out for the App Store review account', async () => {
    host.reviewAccount = true;
    answerNativeCommands('ota');
    mountWith('UpdateFound');

    expect(await screen.findByText('2026.1119.1')).toBeTruthy();
    expect(screen.queryByText('Bundle date')).toBeNull();
    expect(screen.queryByText('App update')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('has no Updates section in desktop builds without the updater', async () => {
    host.platform = 'desktop';
    answerNativeCommands('embedded');
    mountWith('Idle', 'Disabled');

    expect(await screen.findByText('2026.1119.1')).toBeTruthy();
    expect(screen.queryByText('Updates')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('restarts the desktop app into a downloaded app update', async () => {
    host.platform = 'desktop';
    answerNativeCommands('embedded');
    mountWith('Completed', 'Ready');

    expect(screen.getByRole('heading', { name: 'Desktop App' })).toBeTruthy();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Restart to update' })
    );

    expect(restartNativeUpdate).toHaveBeenCalledOnce();
    expect(screen.queryByText('App update')).toBeNull();
  });
});
