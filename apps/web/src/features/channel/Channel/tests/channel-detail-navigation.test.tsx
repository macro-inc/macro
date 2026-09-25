import { createBlockOrchestrator } from '@core/orchestrator';
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
  ChannelTopIcon: () => null,
}));
vi.mock('@channel/Participants/ChannelParticipantsTab', () => ({
  ChannelParticipantsTab: () => null,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => orchestrator,
}));
vi.mock(
  '@components/app/split-layout/components/PriorityCollapseOverflowSensor',
  () => ({
    createPriorityCollapseController: () => ({
      setRow: vi.fn(),
      collapser: undefined,
    }),
    PriorityCollapseOverflowSensor: mocks.pass,
  })
);
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useRegisterPriorityCollapseItem: () => () => false,
  useSplitPanelOrThrow: () => ({ splitHotkeyScope: 'test-scope' }),
}));
vi.mock('@core/component/TabsInset', () => ({ TabsInset: () => null }));
vi.mock('@core/context/channels', () => ({
  useChannelName: () => () => 'channel-name',
  useChannelType: () => () => 'private',
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
  mocks.requests.length = 0;
  mocks.joinRequested = false;
});
afterEach(cleanup);

describe('channel detail navigation', () => {
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
