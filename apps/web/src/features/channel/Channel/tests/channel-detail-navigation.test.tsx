import { createBlockOrchestrator } from '@core/orchestrator';
import type { DirectoryChannel } from '@queries/channel/directory-core';
import {
  directoryChannel,
  directoryParticipant,
} from '@queries/channel/tests/directory-channel';
import { cleanup, render } from '@solidjs/testing-library';
import { type Accessor, createComputed, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelTargetRequest } from '../ChannelSurface';
import { useChannelTab } from '../ChannelTabContext';
import { type ChannelTabId, DEFAULT_CHANNEL_TAB } from '../channel-tabs';

const orchestrator = createBlockOrchestrator();
const mocks = vi.hoisted(() => ({
  pass: (props: { children?: JSX.Element }) => props.children,
  requests: [] as (ChannelTargetRequest | undefined)[],
  joinRequested: false,
  channel: undefined as DirectoryChannel | undefined,
  dmWork: [] as { direct: boolean; members: readonly string[] }[],
}));

const analytics = vi.hoisted(() => ({ pageView: vi.fn(), track: vi.fn() }));
vi.mock('@app/features/agent-work/views/dm-work', () => ({
  DmWorkProvider: (props: {
    isDirectMessage: boolean;
    participantIds: readonly string[];
    children: unknown;
  }) => {
    createComputed(() =>
      mocks.dmWork.push({
        direct: props.isDirectMessage,
        members: props.participantIds,
      })
    );
    return props.children;
  },
  DmWorkPanel: () => null,
  DmWorkToggle: () => null,
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => analytics,
}));
vi.mock('@channel/Channel/ChannelSurface', () => ({
  ChannelSurface: (props: {
    targetRequest?: ChannelTargetRequest;
    children?: JSX.Element;
  }) => {
    // The real surface navigates on each fresh request object; record them all.
    createComputed(() => mocks.requests.push(props.targetRequest));
    return props.children;
  },
  ChannelMessages: () => null,
}));
vi.mock('@app/components/view-shell', () => ({
  ViewShell: { TopBar: mocks.pass },
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  ChatWithAgentButton: () => null,
  openChatWithAgent: vi.fn(),
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
  ChannelCallAutoJoin: (props: { pendingJoinCall: () => boolean }) => {
    createComputed(() => {
      if (props.pendingJoinCall()) mocks.joinRequested = true;
    });
    return null;
  },
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
vi.mock('@channel/components/ChannelTopIcon', () => ({
  ChannelTitleIcon: () => null,
}));
vi.mock('@channel/Participants/ChannelParticipantsTab', () => ({
  ChannelParticipantsTab: () => null,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => orchestrator,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitDisplayName: () => {},
  useSplitPanelOrThrow: () => ({ splitHotkeyScope: 'test-scope' }),
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 0, height: 0 }),
}));
vi.mock('@ui/components/Tabs', () => ({ Tabs: () => null }));
vi.mock(import('@core/context/channels'), async (importOriginal) => ({
  channelMemberIds: (await importOriginal()).channelMemberIds,
  useChannel: () => () => mocks.channel,
  useChannelCanCall: () => () => true,
  useChannelName: () => () => 'channel-name',
  useChannelType: () => () => mocks.channel?.channelType ?? 'private',
}));
vi.mock('@queries/channel/channel-participants', () => ({
  useChannelParticipantsQuery: () => ({ isSuccess: false, data: undefined }),
}));
// Keep the orchestrator's registry real without pulling every block definition.
vi.mock('@core/constant/allBlocks', () => ({
  blocks: {},
  resolveBlockAlias: (type: string) => type,
}));
// Live viewer indicators open the shared connection's socket, which jsdom
// rejects; the top bar they belong to is the host's, not this test's subject.
vi.mock('../ChannelTopBarLiveIndicators', () => ({
  ChannelLiveIndicators: () => null,
}));
vi.mock('../use-channel-tab-items', () => ({
  canUseInlineCallTab: () => false,
  normalizeChannelTab: (tab: string) => tab,
  useChannelTabItems: () => () => [],
}));

import { ChannelDetail } from '../ChannelDetail';

const CHANNEL_ID = 'channel-1';

const navigate = async (params: Record<string, string>) => {
  const handle = await orchestrator.getBlockHandle(CHANNEL_ID, 'channel');
  await handle?.goToLocationFromParams(params);
};

const messageRequests = () =>
  mocks.requests.filter(
    (request): request is Extract<ChannelTargetRequest, { kind: 'message' }> =>
      request?.kind === 'message'
  );

beforeEach(() => {
  analytics.track.mockClear();
  mocks.requests.length = 0;
  mocks.joinRequested = false;
  mocks.channel = undefined;
  mocks.dmWork.length = 0;
});
afterEach(cleanup);

describe('channel detail DM work', () => {
  // The REST list counted a DM's bot among its participants, and DM Work
  // decides whose work to show from every member; the directory keeps bots
  // apart, so the detail adds them back.
  it('hands DM Work every member of the DM, its bot included', () => {
    mocks.channel = directoryChannel(CHANNEL_ID, {
      channelType: 'direct_message',
      participants: [directoryParticipant('viewer')],
      botParticipants: [
        {
          botId: 'agent-bot',
          role: 'member',
          joinedAt: '2026-11-01T00:00:00+00:00',
          leftAt: null,
        },
      ],
    });
    render(() => (
      <ChannelDetail channelId={CHANNEL_ID}>{() => null}</ChannelDetail>
    ));
    expect(mocks.dmWork.at(-1)).toEqual({
      direct: true,
      members: ['viewer', 'bot|agent-bot'],
    });
  });
});

describe('channel detail navigation', () => {
  it('counts one open per channel shown', async () => {
    const view = render(() => (
      <ChannelDetail channelId={CHANNEL_ID}>{() => null}</ChannelDetail>
    ));
    await navigate({ message: 'message-1' });

    expect(analytics.track.mock.calls).toEqual([
      ['open_entity', { entityType: 'channel', entityId: CHANNEL_ID }],
    ]);
    view.unmount();
  });

  it('measures tab content against the height left after channel chrome', () => {
    const view = render(() => (
      <ChannelDetail channelId={CHANNEL_ID}>{() => null}</ChannelDetail>
    ));

    const content = view.container.querySelector('[data-channel-tab-content]');
    expect(content?.classList.contains('min-h-0')).toBe(true);
    expect(content?.classList.contains('flex-1')).toBe(true);
  });

  it('navigates the surface for every message link click, including a repeat', async () => {
    render(() => (
      <ChannelDetail channelId={CHANNEL_ID}>{() => null}</ChannelDetail>
    ));
    expect(mocks.requests).toEqual([undefined]);

    await navigate({ channel_message_id: 'message-1' });
    expect(messageRequests()).toEqual([
      { kind: 'message', messageId: 'message-1' },
    ]);

    // Clicking the same link again re-aims the target, so a released
    // highlight comes back rather than the second click doing nothing.
    await navigate({ channel_message_id: 'message-1' });
    expect(messageRequests()).toHaveLength(2);
    expect(messageRequests()[0]).not.toBe(messageRequests()[1]);

    await navigate({
      channel_message_id: 'reply-1',
      channel_thread_id: 'message-2',
    });
    expect(messageRequests().at(-1)).toEqual({
      kind: 'message',
      messageId: 'reply-1',
      threadId: 'message-2',
    });
  });

  it('keeps serving the host target when no navigation arrives', async () => {
    render(() => (
      <ChannelDetail
        channelId={CHANNEL_ID}
        target={{ kind: 'message', messageId: 'deep-link' }}
      >
        {() => null}
      </ChannelDetail>
    ));
    expect(messageRequests()).toEqual([
      { kind: 'message', messageId: 'deep-link' },
    ]);
  });

  it('sends call params to the call tab and joins only when asked', async () => {
    let activeTab: Accessor<ChannelTabId> | undefined;
    render(() => (
      <ChannelDetail channelId={CHANNEL_ID}>
        {() => {
          activeTab = useChannelTab().activeTab;
          return null;
        }}
      </ChannelDetail>
    ));
    expect(activeTab?.()).toBe(DEFAULT_CHANNEL_TAB);

    await navigate({ open_call_tab: 'true' });
    expect(activeTab?.()).toBe('call');
    expect(mocks.joinRequested).toBe(false);

    await navigate({ channel_message_id: 'message-1' });
    expect(activeTab?.()).toBe(DEFAULT_CHANNEL_TAB);

    await navigate({ join_call: 'true' });
    expect(activeTab?.()).toBe('call');
    expect(mocks.joinRequested).toBe(true);

    // A message target that arrives alongside a call param is kept, so
    // returning to Messages lands on it.
    await navigate({ open_call_tab: 'true', channel_message_id: 'message-2' });
    expect(activeTab?.()).toBe('call');
    expect(messageRequests().at(-1)).toEqual({
      kind: 'message',
      messageId: 'message-2',
    });
  });
});
