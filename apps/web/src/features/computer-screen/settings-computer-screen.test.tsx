import type { Harness } from '@service-storage/generated/schemas/harness';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { useSettingsComputerScreen } from './context/settings-screen-context';
import { SettingsComputerScreen } from './settings-computer-screen';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  toast: vi.fn(),
  connect: vi.fn(),
  mobile: false,
  enabled: true,
  agentsEnabled: false,
  loading: false,
  directoryError: false,
  refetch: vi.fn(),
  directorySnapshot: (): { error: boolean; hasData: boolean } | undefined =>
    undefined,
  access: 'read' as Harness['access'],
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.toast },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () =>
    flag.key === 'enable-macro-computers'
      ? { enabled: mocks.enabled, loading: mocks.loading }
      : { enabled: mocks.agentsEnabled, loading: false },
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.mobile,
}));
vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessDirectoryQuery: () => ({
    get isSuccess() {
      return !(mocks.directorySnapshot()?.error ?? mocks.directoryError);
    },
    isPending: false,
    get isError() {
      return mocks.directorySnapshot()?.error ?? mocks.directoryError;
    },
    refetch: mocks.refetch,
    get data() {
      if (mocks.directorySnapshot()?.hasData === false) return undefined;
      return [
        {
          id: 'runtime',
          name: 'Agent computer',
          access: mocks.access,
        },
      ];
    },
  }),
}));
vi.mock('@queries/team-agents', () => ({
  useTeamAgentComputerMutation: () => ({ mutateAsync: mocks.lookup }),
}));
vi.mock('./queries/novnc', () => ({ connectScreen: mocks.connect }));
vi.mock('@app/lib/service-clients/service-agent-harness/screen-url', () => ({
  resolveScreenUrl: async () => 'wss://example.invalid/screen',
}));

function Open() {
  const computer = useSettingsComputerScreen();
  return (
    <button onClick={() => computer?.openAgentComputer('agent')}>
      Open agent computer
    </button>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  mocks.mobile = false;
  mocks.enabled = true;
  mocks.agentsEnabled = false;
  mocks.loading = false;
  mocks.directoryError = false;
  mocks.directorySnapshot = () => undefined;
  mocks.refetch.mockResolvedValue({});
  mocks.access = 'read';
  mocks.lookup.mockResolvedValue({
    computerId: 'computer',
    harnessId: 'runtime',
    isAgentComputer: true,
  });
  mocks.connect.mockResolvedValue({ disconnect: vi.fn() });
});
it('resolves the agent on click and starts a reader without input', async () => {
  render(() => (
    <SettingsComputerScreen>
      <Open />
    </SettingsComputerScreen>
  ));
  expect(mocks.lookup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open agent computer' }));
  await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Take control' })).toBeNull();
  expect(mocks.connect.mock.calls.at(-1)?.[2]).toBe(false);
  expect(screen.queryByText(/Request edit access to take control/)).toBeNull();
});
it('keeps phones watch-only even when the runtime grants User', async () => {
  mocks.mobile = true;
  mocks.access = 'user';
  render(() => (
    <SettingsComputerScreen>
      <Open />
    </SettingsComputerScreen>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Open agent computer' }));
  await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Take control' })).toBeNull();
});

it('lets a desktop User explicitly take control after starting as a watcher', async () => {
  mocks.access = 'user';
  render(() => (
    <SettingsComputerScreen>
      <Open />
    </SettingsComputerScreen>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Open agent computer' }));
  const control = await screen.findByRole('button', { name: 'Take control' });
  await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
  expect(mocks.connect.mock.calls.at(-1)?.[2]).toBe(false);
  fireEvent.click(control);
  await waitFor(() => expect(mocks.connect.mock.calls.at(-1)?.[2]).toBe(true));
});

it.each([
  { enabled: false, loading: false },
  { enabled: true, loading: true },
])(
  'does not discover or connect while the rollout is unavailable: %j',
  ({ enabled, loading }) => {
    mocks.agentsEnabled = true;
    mocks.enabled = enabled;
    mocks.loading = loading;
    render(() => (
      <SettingsComputerScreen>
        <Open />
      </SettingsComputerScreen>
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Open agent computer' })
    );
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  }
);

it('retains cached runtime access when a directory refresh fails', async () => {
  mocks.directoryError = true;
  render(() => (
    <SettingsComputerScreen>
      <Open />
    </SettingsComputerScreen>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Open agent computer' }));
  await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
  expect(screen.getByRole('alert').textContent).toContain(
    'Could not refresh computer access'
  );
  expect(screen.queryByRole('button', { name: 'Request access' })).toBeNull();
});

it('retries directory discovery when reopening after the service recovers', async () => {
  const [state, setState] = createSignal({ error: true, hasData: false });
  mocks.directorySnapshot = state;
  let recovered = false;
  mocks.refetch.mockImplementation(async () => {
    if (recovered) setState({ error: false, hasData: true });
    return {};
  });
  render(() => (
    <SettingsComputerScreen>
      <Open />
    </SettingsComputerScreen>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Open agent computer' }));
  await screen.findByRole('alert');
  expect(mocks.connect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close screen' }));
  recovered = true;
  fireEvent.click(screen.getByRole('button', { name: 'Open agent computer' }));
  await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
  expect(mocks.refetch).toHaveBeenCalledTimes(2);
});

it('closes unavailable computer discovery quietly without a failure surface', async () => {
  mocks.lookup.mockResolvedValue(null);
  render(() => (
    <SettingsComputerScreen>
      <Open />
    </SettingsComputerScreen>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Open agent computer' }));
  await waitFor(() => expect(mocks.lookup).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Computer screen' })).toBeNull()
  );
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
});
it('keeps actual discovery errors visible and toasts them', async () => {
  mocks.lookup.mockRejectedValue(new Error('HTTP 500'));
  render(() => (
    <SettingsComputerScreen>
      <Open />
    </SettingsComputerScreen>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Open agent computer' }));
  await waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith('Could not load computer')
  );
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(mocks.connect).not.toHaveBeenCalled();
});
