import type { Harness } from '@service-storage/generated/schemas/harness';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flag: () => ({ enabled: true, loading: false }),
  agent: true,
  mobile: false,
  capability: true,
  access: 'read' as Harness['access'],
  paired: true,
  open: vi.fn(),
  request: vi.fn(),
  settings: vi.fn(),
  discovery: vi.fn(),
  directory: vi.fn(),
  local: true,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => mocks.flag(),
}));
vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  isAgentAccount: () => mocks.agent,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.mobile,
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: mocks.settings }),
}));
vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({
    isPending: false,
    data: [{ bot: { id: 'custom-agent' }, harness_id: 'runtime-1' }],
  }),
}));
vi.mock('@queries/team-agents', () => ({
  useTeamAgentComputerQuery: (_id: () => string, enabled: () => boolean) => {
    mocks.discovery(enabled());
    return {
      isPending: false,
      get data() {
        return enabled()
          ? {
              computerId: 'computer-1',
              harnessId: mocks.paired ? 'runtime-1' : null,
              isAgentComputer: true,
            }
          : undefined;
      },
    };
  },
}));
vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessDirectoryQuery: (enabled: () => boolean) => {
    mocks.directory(enabled());
    return {
      isPending: false,
      get data() {
        return enabled()
          ? [
              {
                id: 'runtime-1',
                access: mocks.access,
                capabilities: { screen: mocks.capability },
              },
            ]
          : undefined;
      },
    };
  },
}));
vi.mock('./context/settings-screen-context', () => ({
  useSettingsComputerScreen: () =>
    mocks.local ? { openHarness: mocks.open } : undefined,
}));
vi.mock('./context/settings-screen-navigation', () => ({
  useOptionalSettingsScreenNavigation: () => ({ request: mocks.request }),
}));

import { AgentPortraitScreenActions } from './agent-portrait-screen-actions';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.flag = () => ({ enabled: true, loading: false });
  mocks.agent = true;
  mocks.mobile = false;
  mocks.capability = true;
  mocks.paired = true;
  mocks.access = 'read';
  mocks.local = true;
});
it.each(['read', 'resident', 'none'] as const)(
  'offers watch mode and no control for %s access',
  (access) => {
    mocks.access = access;
    render(() => (
      <AgentPortraitScreenActions userId="macro|agent@example.com" />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Show screen' }));
    expect(mocks.open).toHaveBeenCalledWith('runtime-1', false);
    expect(screen.queryByRole('button', { name: 'Take control' })).toBeNull();
  }
);
it.each(['user', 'owner'] as const)(
  'offers explicit control for desktop %s access',
  (access) => {
    mocks.access = access;
    render(() => (
      <AgentPortraitScreenActions userId="macro|agent@example.com" />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Take control' }));
    expect(mocks.open).toHaveBeenCalledWith('runtime-1', true);
  }
);
it('keeps phones watch-only even for an owner', () => {
  mocks.access = 'owner';
  mocks.mobile = true;
  render(() => <AgentPortraitScreenActions userId="macro|agent@example.com" />);
  expect(screen.queryByRole('button', { name: 'Take control' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show screen' }));
  expect(mocks.open).toHaveBeenCalledWith('runtime-1', false);
});
it.each(['human', 'no-screen', 'unpaired'] as const)(
  'offers no action for %s',
  (missing) => {
    mocks.agent = missing !== 'human';
    mocks.capability = missing !== 'no-screen';
    mocks.paired = missing !== 'unpaired';
    render(() => (
      <AgentPortraitScreenActions userId="macro|agent@example.com" />
    ));
    expect(screen.queryByRole('button')).toBeNull();
  }
);
it('mounts no discovery while the rollout is loading or off', () => {
  const [flag, setFlag] = createSignal({ enabled: false, loading: true });
  mocks.flag = flag;
  render(() => <AgentPortraitScreenActions userId="macro|agent@example.com" />);
  expect(mocks.discovery).not.toHaveBeenCalled();
  setFlag({ enabled: false, loading: false });
  expect(mocks.discovery).not.toHaveBeenCalled();
  setFlag({ enabled: true, loading: false });
  expect(screen.getByRole('button', { name: 'Show screen' })).toBeTruthy();
});
it('carries the selected mode into Settings when opened from another view', () => {
  mocks.local = false;
  mocks.access = 'owner';
  render(() => <AgentPortraitScreenActions userId="macro|agent@example.com" />);
  fireEvent.click(screen.getByRole('button', { name: 'Take control' }));
  expect(mocks.request).toHaveBeenCalledWith('runtime-1', true);
  expect(mocks.settings).toHaveBeenCalledWith('Harness');
});

it('discovers a bot-bound screen without querying the managed-agent endpoint', () => {
  mocks.agent = false;
  render(() => <AgentPortraitScreenActions userId="bot|custom-agent" />);
  expect(mocks.discovery).toHaveBeenCalledWith(false);
  fireEvent.click(screen.getByRole('button', { name: 'Show screen' }));
  expect(mocks.open).toHaveBeenCalledWith('runtime-1', false);
});
