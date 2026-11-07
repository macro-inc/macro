import type { Harness } from '@service-storage/generated/schemas/harness';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flag: () => ({ enabled: true, loading: false }),
  type: 'direct_message',
  botId: undefined as string | undefined,
  agent: true,
  paired: true,
  capability: true,
  access: () => 'read' as Harness['access'],
  participants: ['macro|viewer@example.com', 'macro|agent@example.com'],
  open: vi.fn(),
  discovery: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => mocks.flag(),
}));
vi.mock('@core/context/channels', () => ({
  useChannel: () => () => ({
    channel_type: mocks.type,
    agent_dm: mocks.botId ? { bot_id: mocks.botId } : undefined,
    participants: mocks.participants.map((user_id) => ({ user_id })),
  }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|viewer@example.com',
}));
vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  isAgentAccount: () => mocks.agent,
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: vi.fn() }),
}));
vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({
    isPending: false,
    data: [{ bot: { id: 'custom-agent' }, harness_id: 'runtime-1' }],
  }),
}));
vi.mock('@queries/team-agents', () => ({
  useTeamAgentComputerQuery: (id: () => string, enabled: () => boolean) => {
    mocks.discovery(id(), enabled());
    return {
      isPending: false,
      data: enabled()
        ? { harnessId: mocks.paired ? 'runtime-1' : null }
        : undefined,
    };
  },
}));
vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessDirectoryQuery: (enabled: () => boolean) => ({
    isPending: false,
    get data() {
      return enabled()
        ? [
            {
              id: 'runtime-1',
              access: mocks.access(),
              capabilities: { screen: mocks.capability },
            },
          ]
        : [];
    },
  }),
}));
vi.mock(
  '@app/features/computer-screen/context/settings-screen-context',
  () => ({ useSettingsComputerScreen: () => ({ openHarness: mocks.open }) })
);

import { ChannelComputerButton } from '../ChannelComputerButton';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.flag = () => ({ enabled: true, loading: false });
  mocks.type = 'direct_message';
  mocks.botId = undefined;
  mocks.agent = true;
  mocks.paired = true;
  mocks.capability = true;
  mocks.access = () => 'read';
  mocks.participants = ['macro|viewer@example.com', 'macro|agent@example.com'];
});
it.each(['read', 'resident', 'user', 'owner'] as const)(
  'opens the accessible agent computer in watch mode for %s',
  (access) => {
    mocks.access = () => access;
    render(() => <ChannelComputerButton channelId="channel-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'View computer' }));
    expect(mocks.open).toHaveBeenCalledWith('runtime-1', false);
  }
);
it.each([
  'human',
  'group',
  'channel',
  'unpaired',
  'no-screen',
  'no-access',
] as const)('omits the action for %s', (missing) => {
  if (missing === 'human') mocks.agent = false;
  if (missing === 'group') mocks.participants.push('macro|person@example.com');
  if (missing === 'channel') mocks.type = 'private';
  if (missing === 'unpaired') mocks.paired = false;
  if (missing === 'no-screen') mocks.capability = false;
  if (missing === 'no-access') mocks.access = () => 'none';
  render(() => <ChannelComputerButton channelId="channel-1" />);
  expect(screen.queryByRole('button', { name: 'View computer' })).toBeNull();
});
it('mounts no discovery while the feature flag is loading or off', () => {
  const [flag, setFlag] = createSignal({ enabled: false, loading: true });
  mocks.flag = flag;
  render(() => <ChannelComputerButton channelId="channel-1" />);
  expect(mocks.discovery).not.toHaveBeenCalled();
  setFlag({ enabled: false, loading: false });
  expect(mocks.discovery).not.toHaveBeenCalled();
  setFlag({ enabled: true, loading: false });
  expect(screen.getByRole('button', { name: 'View computer' })).toBeTruthy();
});
it('guards an old button handler after access is revoked', () => {
  const [access, setAccess] = createSignal<Harness['access']>('read');
  mocks.access = access;
  render(() => <ChannelComputerButton channelId="channel-1" />);
  const button = screen.getByRole('button', { name: 'View computer' });
  setAccess('none');
  fireEvent.click(button);
  expect(mocks.open).not.toHaveBeenCalled();
});

it('opens a canonical bot DM through the bot-bound runtime', () => {
  mocks.botId = 'custom-agent';
  mocks.agent = false;
  mocks.participants = ['macro|viewer@example.com'];
  render(() => <ChannelComputerButton channelId="channel-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'View computer' }));
  expect(mocks.discovery).toHaveBeenCalledWith('bot|custom-agent', false);
  expect(mocks.open).toHaveBeenCalledWith('runtime-1', false);
});
