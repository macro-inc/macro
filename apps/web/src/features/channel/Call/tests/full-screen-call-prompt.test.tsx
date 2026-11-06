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

vi.mock('@core/component/Toast/Toast', async () => {
  const fake = await import('@core/component/Toast/tests/fake-toast');
  return {
    ...fake,
    toast: {
      ...fake.toast,
      custom: (
        config: Parameters<typeof fake.toast.custom>[0],
        options?: { onUserDismiss?: () => void }
      ) => {
        let id: number;
        id = fake.toast.custom({
          ...config,
          actions: [
            ...(config.actions ?? []),
            {
              label: 'Dismiss',
              onClick: () => {
                options?.onUserDismiss?.();
                fake.toast.dismiss(id);
              },
            },
          ],
        });
        return id;
      },
    },
  };
});
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

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => visibility,
});

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Leaves for Settings and comes back, as the Android WebView reports it. */
function returnFromSettings() {
  setVisibility('hidden');
  setVisibility('visible');
}

/** Waits for the mount check to reach native and its result to land. */
async function settleAccessCheck() {
  await waitFor(() => expect(accessChecks()).toBeGreaterThan(0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('full-screen call prompt', () => {
  beforeEach(() => {
    localStorage.clear();
    visibility = 'visible';
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
    expect(
      localStorage.getItem('full-screen-call-prompt-dismissed')
    ).toBeNull();

    // Leaving for Settings doesn't check; coming back without allowing it
    // checks once and keeps the toast, with Allow still there.
    const checks = accessChecks();
    setVisibility('hidden');
    expect(accessChecks()).toBe(checks);
    setVisibility('visible');
    await waitFor(() => expect(accessChecks()).toBe(checks + 1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();

    native.allowed = true;
    returnFromSettings();
    await waitFor(() => expect(screen.queryByText(title)).toBeNull());

    // Granted: later returns don't bring it back.
    returnFromSettings();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(title)).toBeNull();
  });

  it('ignores an earlier check that finishes after a later one', async () => {
    renderPrompt();
    await screen.findByText(title);

    const pending: ((state: { allowed: boolean }) => void)[] = [];
    native.invoke.mockImplementation((command: string) =>
      command === 'plugin:call-kit|can_use_full_screen_intent'
        ? new Promise((resolve) => pending.push(resolve))
        : Promise.resolve()
    );
    returnFromSettings();
    returnFromSettings();
    await waitFor(() => expect(pending).toHaveLength(2));

    pending[1]({ allowed: true });
    await waitFor(() => expect(screen.queryByText(title)).toBeNull());
    pending[0]({ allowed: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(title)).toBeNull();
  });

  it('stays hidden on the next launch once access is granted', async () => {
    native.allowed = true;
    renderPrompt();
    await settleAccessCheck();
    expect(screen.queryByText(title)).toBeNull();
    expect(
      localStorage.getItem('full-screen-call-prompt-dismissed')
    ).toBeNull();
  });

  it('stays hidden on this device once dismissed', async () => {
    const first = renderPrompt();
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(localStorage.getItem('full-screen-call-prompt-dismissed')).toBe(
      'true'
    );
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
