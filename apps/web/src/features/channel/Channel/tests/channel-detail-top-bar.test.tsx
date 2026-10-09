import type { ChannelEntity } from '@entity';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pass: (props: { children?: JSX.Element }) => props.children,
  channel: (): ChannelEntity | undefined => undefined,
}));

vi.mock('@app/components/view-shell', () => ({
  ViewShell: { TopBar: mocks.pass },
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  ChatWithAgentButton: () => null,
}));
vi.mock('@app/features/next-soup/actions', () => ({
  toSingleEntityActionListState: () => ({}),
}));
vi.mock('@app/features/soup/entity-notifications', () => ({
  withEntityNotifications: (entity: ChannelEntity) => entity,
}));
// The dropdown's own contents are the soup menu's concern; this test is about
// the top bar offering it at all.
vi.mock('@app/features/soup/SoupEntityActionsDropdown', () => ({
  SoupEntityActionsDropdown: (props: {
    entity: ChannelEntity;
    triggerProps?: { label?: string };
  }) => (
    <button type="button" aria-label={props.triggerProps?.label}>
      {props.entity.id}
    </button>
  ),
}));
vi.mock('@channel/Attachments/ChannelAttachmentsTab', () => ({
  ChannelAttachmentsTab: () => null,
}));
vi.mock('@channel/Bots/use-channel-bot-management', () => ({
  useChannelBotManagement: () => ({
    enabled: () => false,
    openCreateBot: vi.fn(),
    openBot: vi.fn(),
    inviteFocusRequest: () => undefined,
  }),
}));
vi.mock('@channel/Call/CallContext', () => ({
  useCallContextOptional: () => undefined,
}));
vi.mock('@channel/Call/CallEventSync', () => ({ CallEventSync: () => null }));
vi.mock('@channel/Call/ChannelCallAutoJoin', () => ({
  ChannelCallAutoJoin: () => null,
}));
vi.mock('@channel/Call/ChannelCallButton', () => ({
  ChannelCallButton: () => null,
}));
vi.mock('@channel/Call/ChannelCallTab', () => ({ ChannelCallTab: () => null }));
vi.mock('@channel/Call/use-call', () => ({
  useCall: () => ({ isInThisChannel: () => false }),
}));
vi.mock('@channel/Calls/ChannelCallsTab', () => ({
  ChannelCallsTab: () => null,
}));
vi.mock('@channel/channel-invite-button', () => ({
  ChannelInviteButton: () => null,
}));
vi.mock('@channel/components/ChannelTopIcon', () => ({
  ChannelTopIcon: () => null,
}));
vi.mock('@channel/Participants/ChannelParticipantsTab', () => ({
  ChannelParticipantsTab: () => null,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => ({}),
  useGlobalNotificationSource: () => ({}),
}));
vi.mock(
  '@components/app/split-layout/components/PriorityCollapseOverflowSensor',
  () => ({
    createPriorityCollapseController: () => ({
      setRow: () => {},
      collapser: undefined,
    }),
    PriorityCollapseOverflowSensor: mocks.pass,
  })
);
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useRegisterPriorityCollapseItem: () => () => false,
  useSplitDisplayName: () => {},
  useSplitPanelOrThrow: () => ({ splitHotkeyScope: 'test-scope' }),
}));
vi.mock('@core/component/TabsInset', () => ({ TabsInset: () => null }));
vi.mock('@core/constant/allBlocks', () => ({
  blocks: {},
  resolveBlockAlias: (type: string) => type,
}));
vi.mock('@core/context/channels', () => ({
  useChannelName: () => () => 'Design',
  useChannelType: () => () => 'private',
}));
vi.mock('@queries/channel/channel-participants', () => ({
  useChannelParticipantsQuery: () => ({ isSuccess: false, data: undefined }),
}));
vi.mock('../ChannelSurface', () => ({
  ChannelSurface: mocks.pass,
  ChannelMessages: () => null,
}));
vi.mock('../ChannelTabContext', () => ({
  ChannelTabProvider: mocks.pass,
  useChannelTab: () => ({
    activeTab: () => 'messages',
    setActiveTab: () => {},
  }),
}));
vi.mock('../ChannelTopBarLiveIndicators', () => ({
  ChannelLiveIndicators: () => null,
}));
vi.mock('../channel-entity', () => ({
  useChannelEntity: () => () => mocks.channel(),
}));
vi.mock('../use-channel-tab-items', () => ({
  canUseInlineCallTab: () => false,
  normalizeChannelTab: (tab: string) => tab,
  useChannelTabItems: () => () => [],
}));

import { ChannelDetailTopBar } from '../ChannelDetail';

const CHANNEL: ChannelEntity = {
  id: 'channel-1',
  type: 'channel',
  name: 'Design',
  ownerId: 'owner',
  channelType: 'private',
};

const [resolved, setResolved] = createSignal<ChannelEntity | undefined>();
mocks.channel = resolved;

beforeEach(() => setResolved(CHANNEL));
afterEach(cleanup);

/**
 * Every surface that opens a conversation composes this one top bar, so the
 * title menu must come from the bar rather than from each host. Home supplies
 * breadcrumbs through `leading`; Chat lets the bar render its own title.
 */
describe('channel top bar title menu', () => {
  it('offers the conversation actions beside its own title', async () => {
    render(() => <ChannelDetailTopBar channelId="channel-1" />);

    const actions = await screen.findByLabelText('Channel actions');
    expect(actions.textContent).toBe('channel-1');
  });

  it('offers the same actions beside a host-supplied leading slot', async () => {
    render(() => (
      <ChannelDetailTopBar
        channelId="channel-1"
        leading={<span data-testid="breadcrumbs">Home / Design</span>}
      />
    ));

    const actions = await screen.findByLabelText('Channel actions');
    expect(actions.textContent).toBe('channel-1');
    expect(actions.parentElement).toBe(
      screen.getByTestId('breadcrumbs').parentElement
    );
  });

  it('waits for the conversation rather than showing an empty menu', async () => {
    setResolved(undefined);
    render(() => <ChannelDetailTopBar channelId="channel-1" />);
    expect(screen.queryByLabelText('Channel actions')).toBeNull();

    setResolved(CHANNEL);

    expect(await screen.findByLabelText('Channel actions')).toBeTruthy();
  });
});
