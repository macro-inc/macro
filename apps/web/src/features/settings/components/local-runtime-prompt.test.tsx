/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRuntimePrompt } from './local-runtime-prompt';

const mocks = vi.hoisted(() => ({
  desktop: true,
  supported: true,
  paired: false,
  statusPhase: 'stopped',
  inspect: undefined as Promise<{ paired: boolean }> | undefined,
  listen: undefined as Promise<() => void> | undefined,
  openSettings: vi.fn(),
  onStatus: undefined as ((status: { phase: string }) => void) | undefined,
  unlisten: vi.fn(),
}));

vi.mock('@core/util/platform', () => ({
  isDesktopPlatform: () => mocks.desktop,
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: mocks.openSettings }),
}));
let currentUser: () => string | undefined = () => 'user-1';
vi.mock('@core/context/user', () => ({ useUserId: () => currentUser }));
vi.mock('@macro/tauri/macrod', () => ({
  macrodSupport: async () => ({ supported: mocks.supported }),
  macrodInspect: () =>
    mocks.inspect ?? Promise.resolve({ paired: mocks.paired }),
  macrodStatus: async () => ({ phase: mocks.statusPhase }),
  onMacrodStatus: (callback: (status: { phase: string }) => void) => {
    mocks.onStatus = callback;
    return mocks.listen ?? Promise.resolve(mocks.unlisten);
  },
}));

beforeEach(() => {
  mocks.desktop = true;
  mocks.supported = true;
  mocks.paired = false;
  mocks.statusPhase = 'stopped';
  mocks.inspect = undefined;
  mocks.listen = undefined;
  mocks.openSettings.mockClear();
  mocks.unlisten.mockClear();
  mocks.onStatus = undefined;
  currentUser = () => 'user-1';
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('local runtime invitation', () => {
  it('opens local setup from both mounted composer prompts and dismisses both on this computer', async () => {
    render(() => (
      <>
        <LocalRuntimePrompt />
        <LocalRuntimePrompt />
      </>
    ));
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /Run agents on this computer/ })
      ).toHaveLength(4)
    );

    fireEvent.click(screen.getAllByText('Set up')[0]);
    expect(mocks.openSettings).toHaveBeenCalledWith('Harness');

    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'Dismiss Run agents on this computer',
      })[0]
    );
    expect(screen.queryByText('Run agents on this computer')).toBeNull();
    expect(
      localStorage.getItem('macro:local-runtime-prompt:dismissed:user-1')
    ).toBe('1');
  });

  it('keeps dismissal scoped to the signed-in user and this desktop installation', async () => {
    const [user, setUser] = createSignal<string | undefined>('user-1');
    currentUser = user;
    render(() => <LocalRuntimePrompt />);
    await screen.findByText('Run agents on this computer');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Dismiss Run agents on this computer',
      })
    );
    expect(screen.queryByText('Run agents on this computer')).toBeNull();

    setUser('user-2');
    expect(screen.getByText('Run agents on this computer')).toBeTruthy();
    setUser('user-1');
    expect(screen.queryByText('Run agents on this computer')).toBeNull();
  });

  it('does not invite unsupported or already paired installations', async () => {
    mocks.paired = true;
    render(() => <LocalRuntimePrompt />);
    await waitFor(() => expect(mocks.onStatus).toBeTypeOf('function'));
    expect(screen.queryByText('Run agents on this computer')).toBeNull();
    cleanup();

    mocks.supported = false;
    render(() => <LocalRuntimePrompt />);
    expect(screen.queryByText('Run agents on this computer')).toBeNull();
  });

  it('shows the invitation even while the status listener is pending', async () => {
    mocks.listen = new Promise(() => {});
    render(() => <LocalRuntimePrompt />);
    expect(await screen.findByText('Run agents on this computer')).toBeTruthy();
  });

  it('hides a stale invitation when pairing finishes before the listener registers', async () => {
    let finishListening: (stop: () => void) => void = () => {};
    mocks.listen = new Promise((resolve) => {
      finishListening = resolve;
    });
    render(() => <LocalRuntimePrompt />);
    await screen.findByText('Run agents on this computer');

    mocks.paired = true;
    mocks.statusPhase = 'running';
    finishListening(mocks.unlisten);
    await waitFor(() =>
      expect(screen.queryByText('Run agents on this computer')).toBeNull()
    );
  });

  it('hides the invitation once this machine finishes pairing', async () => {
    render(() => <LocalRuntimePrompt />);
    await screen.findByText('Run agents on this computer');
    mocks.onStatus?.({ phase: 'running' });
    expect(screen.queryByText('Run agents on this computer')).toBeNull();
  });

  it('does not show an older unpaired inspection after the runtime connects', async () => {
    let finishInspect: (value: { paired: boolean }) => void = () => {};
    mocks.inspect = new Promise((resolve) => {
      finishInspect = resolve;
    });
    render(() => <LocalRuntimePrompt />);
    await waitFor(() => expect(mocks.onStatus).toBeTypeOf('function'));
    mocks.onStatus?.({ phase: 'running' });
    finishInspect({ paired: false });
    await mocks.inspect;
    expect(screen.queryByText('Run agents on this computer')).toBeNull();
  });
});
