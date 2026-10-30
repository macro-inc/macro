/**
 * @vitest-environment jsdom
 */

import { FakeToaster } from '@core/component/Toast/tests/fake-toast';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FullScreenCallPrompt } from '../FullScreenCallPrompt';

const native = vi.hoisted(() => ({
  allowed: false as boolean | 'unavailable',
  invoke: vi.fn(),
}));

vi.mock(
  '@core/component/Toast/Toast',
  () => import('@core/component/Toast/tests/fake-toast')
);
vi.mock('@core/util/platform', () => ({
  isPlatform: (platform: string) => platform === 'android',
}));
vi.mock('../native-call-platform', () => ({ isNativeCallEnabled: () => true }));
vi.mock('@core/context/user', () => ({
  useTutorialCompleted: () => () => true,
}));
vi.mock('@queries/auth', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('@notifications/notification-settings', () => ({
  useNotificationSettings: () => ({ isSupported: true, isEnabled: () => true }),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));

const title = 'Show Calls on Your Lock Screen';

function renderPrompt() {
  return render(() => (
    <>
      <FakeToaster />
      <FullScreenCallPrompt />
    </>
  ));
}

function accessChecks() {
  return native.invoke.mock.calls.filter(
    ([command]) => command === 'plugin:call-kit|can_use_full_screen_intent'
  ).length;
}

/** Waits for the mount check to reach native and its result to land. */
async function settleAccessCheck() {
  await waitFor(() => expect(accessChecks()).toBeGreaterThan(0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('full-screen call prompt', () => {
  beforeEach(() => {
    localStorage.clear();
    native.allowed = false;
    native.invoke.mockReset();
    native.invoke.mockImplementation(async (command: string) => {
      if (command !== 'plugin:call-kit|can_use_full_screen_intent') return;
      if (native.allowed === 'unavailable') throw new Error('unknown command');
      return { allowed: native.allowed };
    });
  });

  it('stays through a trip to Settings until access is granted', async () => {
    renderPrompt();
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(native.invoke).toHaveBeenCalledWith(
      'plugin:call-kit|open_full_screen_intent_settings'
    );

    // Back from Settings without allowing it.
    const checks = accessChecks();
    fireEvent.focus(window);
    await waitFor(() => expect(accessChecks()).toBe(checks + 1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText(title)).toBeTruthy();

    native.allowed = true;
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByText(title)).toBeNull());
  });

  it('stays hidden on this device once dismissed', async () => {
    const first = renderPrompt();
    fireEvent.click(await screen.findByRole('button', { name: 'Hide' }));
    expect(screen.queryByText(title)).toBeNull();
    first.unmount();

    native.invoke.mockClear();
    renderPrompt();
    await settleAccessCheck();
    expect(screen.queryByText(title)).toBeNull();
  });

  it('never prompts on builds without the access command', async () => {
    native.allowed = 'unavailable';
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPrompt();
    await settleAccessCheck();
    expect(screen.queryByText(title)).toBeNull();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
