import type { ChannelTargetRequest } from '@channel/Channel/ChannelSurface';
import { cleanup, render } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import { NewChannelBlockAdapter } from './NewChannelBlockAdapter';

const state = vi.hoisted(() => ({
  search: {} as { messageId: string; threadId: string; seek: string },
  navigate: (_params: Record<string, unknown>) => {},
  latest: () => {},
}));
vi.mock('@app/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/split-router')>()),
  createSearchParams: () => [state.search],
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@core/block', () => ({ useBlockId: () => 'channel' }));
vi.mock('@core/constant/allBlocks', () => ({
  blocks: {},
  resolveBlockAlias: (type: string) => type,
}));
vi.mock('@core/orchestrator', () => ({
  createMethodRegistration: (
    _handle: unknown,
    methods: {
      goToLocationFromParams: typeof state.navigate;
      goToLatest: typeof state.latest;
    }
  ) => {
    state.navigate = methods.goToLocationFromParams;
    state.latest = methods.goToLatest;
  },
}));
vi.mock('@core/signal/load', () => ({
  blockHandleSignal: { get: () => undefined },
}));
vi.mock('@core/signal/blockElement', () => ({
  blockHotkeyScopeSignal: { set: () => {} },
}));
vi.mock('@solidjs/router', () => ({
  useSearchParams: () => [{}, () => {}],
}));
vi.mock('@app/features/next-soup/actions', () => ({
  useBlockEntityCommands: () => {},
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useCanAutofocusSplitContent: () => false,
  useSplitPanelOrThrow: () => ({
    splitHotkeyScope: 'split',
    handle: {
      currentEntryState: () => undefined,
      registerEntryStateCaptor: () => () => {},
    },
  }),
}));
vi.mock('@components/app/useNavigatedFromJK', () => ({
  useNavigatedFromJK: () => ({ navigatedFromJK: () => false }),
}));
vi.mock('@channel/Call/CallContext', () => ({
  useCallContextOptional: () => undefined,
}));
vi.mock('@channel/Bots/use-channel-bot-management', () => ({
  useChannelBotManagement: () => ({}),
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({}));
vi.mock('@channel/Attachments/ChannelAttachmentsTab', () => ({}));
vi.mock('@channel/Call/CallEventSync', () => ({}));
vi.mock('@channel/Call/ChannelCallAutoJoin', () => ({}));
vi.mock('@channel/Call/ChannelCallButton', () => ({}));
vi.mock('@channel/Call/ChannelCallTab', () => ({}));
vi.mock('@channel/Call/use-call', () => ({}));
vi.mock('@channel/Calls/ChannelCallsTab', () => ({}));
vi.mock('@channel/Channel/ChannelTopBarLiveIndicators', () => ({}));
vi.mock('@channel/Participants/ChannelParticipantsTab', () => ({}));
vi.mock('@channel/channel-invite-button', () => ({}));
vi.mock('@channel/channel-picture', () => ({}));
vi.mock('@components/app/split-layout/components/SplitFileMenu', () => ({}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({}));
vi.mock('@core/context/channels', () => ({}));
vi.mock('@core/context/user', () => ({}));
vi.mock('@queries/call/call', () => ({}));
vi.mock('@queries/channel/channel-participants', () => ({}));
vi.mock('@entity', () => ({}));
vi.mock('@ui', () => ({
  cn: (...values: string[]) => values.join(' '),
}));
vi.mock('@channel/Channel/use-channel-tab-items', () => ({
  normalizeChannelTab: (tab: string) => tab,
}));
vi.mock('./Top', () => ({}));
// Observe the real adapter's requests without mounting the timeline/chrome.
vi.mock('@channel/Channel/ChannelSurface', () => ({
  ChannelSurface: (props: { targetRequest?: ChannelTargetRequest }) => (
    <output>{JSON.stringify(props.targetRequest)}</output>
  ),
  ChannelMessages: () => null,
}));
afterEach(cleanup);

function setup() {
  const [search, setSearch] = createStore({
    messageId: 'route-message',
    threadId: '',
    seek: 'first',
  });
  state.search = search;
  const view = render(() => <NewChannelBlockAdapter />);
  const target = () => {
    const text = view.container.querySelector('output')!.textContent;
    return text ? JSON.parse(text) : undefined;
  };
  return { setSearch, target };
}

it('clears a route-owned channel target and accepts the next request', () => {
  const { setSearch, target } = setup();
  expect(target()).toEqual({ kind: 'message', messageId: 'route-message' });
  setSearch({ messageId: '', seek: '' });
  expect(target()).toBeUndefined();
  setSearch({ messageId: 'reply', threadId: 'thread', seek: 'next' });
  expect(target()).toEqual({
    kind: 'message',
    messageId: 'reply',
    threadId: 'thread',
  });
});

it.each(['message', 'latest'] as const)(
  'preserves an imperative %s request across Home route cleanup',
  (kind) => {
    const { setSearch, target } = setup();
    if (kind === 'message')
      state.navigate({ channel_message_id: 'mention-message' });
    else state.latest();
    setSearch({ messageId: '', seek: '' });
    expect(target()).toEqual(
      kind === 'message'
        ? { kind: 'message', messageId: 'mention-message' }
        : { kind: 'latest' }
    );
    setSearch({ messageId: 'new-route-message', seek: 'next' });
    expect(target()).toEqual({
      kind: 'message',
      messageId: 'new-route-message',
    });
    setSearch({ messageId: '', seek: '' });
    expect(target()).toBeUndefined();
  }
);
