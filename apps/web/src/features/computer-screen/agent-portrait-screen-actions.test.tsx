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
  visible: true,
  open: vi.fn(),
  interaction: vi.fn(() => ({ end: vi.fn() })),
  request: vi.fn(),
  settings: vi.fn(),
  discovery: vi.fn(),
  directory: vi.fn(),
  local: true,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => mocks.flag(),
}));
vi.mock('@app/observability/flow', () => ({
  beginInteraction: mocks.interaction,
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
        return enabled() && mocks.visible
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

import { AgentComputerScreenEntry } from './agent-computer-screen-entry';
import { AgentPortraitScreenActions } from './agent-portrait-screen-actions';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.flag = () => ({ enabled: true, loading: false });
  mocks.agent = true;
  mocks.mobile = false;
  mocks.capability = true;
  mocks.paired = true;
  mocks.visible = true;
  mocks.access = 'read';
  mocks.local = true;
});
it.each(['read', 'resident'] as const)(
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

it.each(['local', 'navigation'] as const)(
  'rejects retained %s screen callbacks when current eligibility changes',
  (destination) => {
    for (const invalidation of [
      'off',
      'loading',
      'deleted',
      'unpaired',
      'directory',
      'capability',
      'access',
      'unmounted',
    ] as const) {
      mocks.local = destination === 'local';
      const [flag, setFlag] = createSignal({ enabled: true, loading: false });
      const [deleted, setDeleted] = createSignal(false);
      mocks.flag = flag;
      mocks.paired = true;
      mocks.visible = true;
      mocks.capability = true;
      mocks.access = 'read';
      const onSelect = vi.fn();
      let retainedOpen: ((control: boolean) => void) | undefined;
      const view = render(() => (
        <AgentComputerScreenEntry
          userId="macro|agent@example.com"
          isDeleted={deleted()}
          onSelect={onSelect}
        >
          {(_harness, open) => {
            retainedOpen = open;
            return <span>Screen entry</span>;
          }}
        </AgentComputerScreenEntry>
      ));
      expect(retainedOpen).toBeTypeOf('function');
      if (invalidation === 'off') setFlag({ enabled: false, loading: false });
      if (invalidation === 'loading') setFlag({ enabled: true, loading: true });
      if (invalidation === 'deleted') setDeleted(true);
      if (invalidation === 'unpaired') mocks.paired = false;
      if (invalidation === 'directory') mocks.visible = false;
      if (invalidation === 'capability') mocks.capability = false;
      if (invalidation === 'access') mocks.access = 'none';
      if (invalidation === 'unmounted') view.unmount();
      retainedOpen!(false);
      expect(mocks.open).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
      expect(mocks.settings).not.toHaveBeenCalled();
      expect(onSelect).not.toHaveBeenCalled();
      expect(mocks.interaction).not.toHaveBeenCalled();
      if (invalidation !== 'unmounted') view.unmount();
    }
  }
);

it('hides portrait screen entries for access none while preserving read and resident watch access', () => {
  mocks.access = 'none';
  const onSelect = vi.fn();
  render(() => (
    <AgentPortraitScreenActions
      userId="macro|agent@example.com"
      onSelect={onSelect}
    />
  ));
  expect(screen.queryByRole('button', { name: 'Show screen' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Take control' })).toBeNull();
  expect(mocks.interaction).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.settings).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});
