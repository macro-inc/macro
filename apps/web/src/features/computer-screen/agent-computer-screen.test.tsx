import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SharingSource } from '../access-requests/context/contracts';
import { fakeSharingSource } from '../access-requests/tests/source';
import { AgentComputerScreen } from './agent-computer-screen';
import { ScreenToggle } from './views/screen-toggle';

const mocks = vi.hoisted(() => ({
  enabled: true,
  agentsEnabled: false,
  loading: false,
  role: 'read',
  directoryEnabled: false,
  agentsQueryEnabled: false,
  connect: vi.fn(),
}));
let requests: SharingSource;
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () =>
    flag.key === 'enable-macro-computers'
      ? { enabled: mocks.enabled, loading: mocks.loading }
      : { enabled: mocks.agentsEnabled, loading: false },
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: (enabled: () => boolean) => {
    mocks.agentsQueryEnabled = enabled();
    return {
      isPending: false,
      data: [{ bot: { id: 'bot' }, harness_id: 'runtime' }],
    };
  },
}));
vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessDirectoryQuery: (enabled: () => boolean) => {
    mocks.directoryEnabled = enabled();
    return {
      isPending: false,
      data: [
        { id: 'runtime', access: mocks.role, capabilities: { screen: true } },
      ],
    };
  },
}));
vi.mock('@app/features/access-requests/queries/source', () => ({
  createSharingSource: () => requests,
}));
vi.mock('./pane-state', async () => {
  const { createSignal } = await import('solid-js');
  return {
    createScreenPaneState: () => {
      const [open, setOpen] = createSignal(false);
      return { open, setOpen };
    },
  };
});
vi.mock('./queries/novnc', () => ({ connectScreen: mocks.connect }));
vi.mock('@app/lib/service-clients/service-agent-harness/screen-url', () => ({
  resolveScreenUrl: async () => 'wss://example.invalid/screen',
}));

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
  mocks.enabled = true;
  mocks.agentsEnabled = false;
  mocks.loading = false;
  mocks.role = 'read';
  mocks.directoryEnabled = false;
  mocks.agentsQueryEnabled = false;
  mocks.connect.mockResolvedValue({ disconnect: vi.fn() });
  requests = fakeSharingSource({
    accessLevel: null,
    supportedLevels: ['view'],
  }).source;
});
function SessionScreen() {
  return (
    <AgentComputerScreen sessionId="session" botId="bot" canEdit>
      <ScreenToggle />
    </AgentComputerScreen>
  );
}
it.each(['read', 'resident'])(
  'opens the %s directory runtime in watch mode',
  async (role) => {
    mocks.role = role;
    render(() => <SessionScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Screen' }));
    await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Take control' })).toBeNull();
    expect(mocks.connect.mock.calls.at(-1)?.[2]).toBe(false);
  }
);
it('opens access requests instead of an unauthorized VNC connection for None', async () => {
  mocks.role = 'none';
  render(() => <SessionScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Screen' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Request access' })
  );
  await waitFor(() =>
    expect(requests.submit).toHaveBeenCalledWith('view', undefined)
  );
  expect(mocks.connect).not.toHaveBeenCalled();
});
it('hides the screen when computers are off even if agent management is on', () => {
  mocks.enabled = false;
  mocks.agentsEnabled = true;
  render(() => <SessionScreen />);
  expect(screen.queryByRole('button', { name: 'Screen' })).toBeNull();
  expect(mocks.directoryEnabled).toBe(false);
  expect(mocks.agentsQueryEnabled).toBe(false);
  expect(mocks.connect).not.toHaveBeenCalled();
});
it('does not expose or query a screen while the rollout is loading', () => {
  mocks.loading = true;
  mocks.agentsEnabled = true;
  render(() => <SessionScreen />);
  expect(screen.queryByRole('button', { name: 'Screen' })).toBeNull();
  expect(mocks.directoryEnabled).toBe(false);
  expect(mocks.agentsQueryEnabled).toBe(false);
  expect(mocks.connect).not.toHaveBeenCalled();
});

it.each(['user', 'owner'])(
  'allows a %s to take control from a session with shared-runtime access',
  async (role) => {
    mocks.role = role;
    render(() => <SessionScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Screen' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Take control' })
    );
    await waitFor(() =>
      expect(mocks.connect.mock.calls.at(-1)?.[2]).toBe(true)
    );
  }
);
