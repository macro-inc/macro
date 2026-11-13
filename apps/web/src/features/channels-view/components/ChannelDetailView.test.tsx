import type { ChannelTargetRequest } from '@channel/Channel/ChannelSurface';
import type {
  NavigationCause,
  ReferredFrom,
} from '@components/app/split-layout/layoutManager';
import type { ChannelEntity } from '@entity/types/entity';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routeSearch: vi.fn((): { seek?: string } => ({})),
  navigationSource: (): ReferredFrom => null,
  navigationCause: (): NavigationCause => 'fresh',
  composerFocusRequest: (): ComposerFocusRequest | undefined => undefined,
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  createSearchParams: () => [mocks.routeSearch()],
}));
vi.mock('@app/features/next-soup/actions', () => ({
  useBlockEntityCommands: vi.fn(),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    splitHotkeyScope: 'test',
    handle: {
      lastNavigationSource: () => mocks.navigationSource(),
      lastNavigationCause: () => mocks.navigationCause(),
    },
  }),
}));
vi.mock('../channels-view-context', () => ({
  useChannelsView: () => ({
    composerFocusRequest: () => mocks.composerFocusRequest(),
    focusRailRow: () => false,
  }),
}));
vi.mock('@channel/Channel/ChannelDetail', () => ({
  ChannelDetail: (props: {
    target?: ChannelTargetRequest;
    navigationRequest?: string;
    autofocus?: boolean;
    composerFocusRequest?: number;
  }) => (
    <output
      data-testid="target"
      data-request={props.navigationRequest}
      data-autofocus={String(props.autofocus)}
      data-focus-request={props.composerFocusRequest}
    >
      {JSON.stringify(props.target)}
    </output>
  ),
  ChannelDetailTopBar: () => null,
}));

import type { ComposerFocusRequest } from '../channels-view-context';
import { ChannelDetailView } from './ChannelDetailView';

const channel: ChannelEntity = {
  id: 'channel',
  type: 'channel',
  name: 'Channel',
  ownerId: 'owner',
  channelType: 'private',
};
const replyTarget = {
  kind: 'message' as const,
  messageId: 'reply',
  threadId: 'root',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.routeSearch.mockReturnValue({});
  mocks.navigationSource = () => null;
  mocks.navigationCause = () => 'fresh';
  mocks.composerFocusRequest = () => undefined;
});
afterEach(cleanup);

describe('Chat detail navigation', () => {
  it('passes an explicit destination to the channel surface', () => {
    render(() => <ChannelDetailView channel={channel} target={replyTarget} />);
    expect(screen.getByTestId('target').textContent).toBe(
      JSON.stringify(replyTarget)
    );
  });

  it('accepts the initial unread destination after the channel has mounted', () => {
    const [target, setTarget] = createSignal<ChannelTargetRequest>();
    render(() => <ChannelDetailView channel={channel} target={target()} />);
    expect(screen.getByTestId('target').textContent).toBe('');
    setTarget(replyTarget);
    expect(screen.getByTestId('target').textContent).toBe(
      JSON.stringify(replyTarget)
    );
  });

  it('does not derive navigation from notification changes', () => {
    const [selected, setSelected] = createSignal(channel);
    render(() => (
      <ChannelDetailView channel={selected()} target={replyTarget} />
    ));
    setSelected({ ...channel, notifications: () => [] });
    expect(screen.getByTestId('target').textContent).toBe(
      JSON.stringify(replyTarget)
    );
  });

  it('replays the same search target without re-deriving it from notifications', () => {
    const [seek, setSeek] = createSignal('first');
    mocks.routeSearch.mockReturnValue({
      get seek() {
        return seek();
      },
    });
    render(() => <ChannelDetailView channel={channel} target={replyTarget} />);
    expect(screen.getByTestId('target').dataset.request).toBe('first');

    setSeek('repeat');

    expect(screen.getByTestId('target').dataset.request).toBe('repeat');
    expect(screen.getByTestId('target').textContent).toBe(
      JSON.stringify(replyTarget)
    );
  });
});

describe('Chat detail composer focus', () => {
  const detail = () => screen.getByTestId('target').dataset;

  afterEach(() => {
    delete document.documentElement.dataset.modality;
  });

  it('focuses the composer of a conversation opened from Cmd+K', () => {
    mocks.navigationSource = () => 'kommand-menu';
    render(() => <ChannelDetailView channel={channel} />);
    expect(detail().autofocus).toBe('true');
  });

  it('focuses the composer of a conversation opened with a click', () => {
    document.documentElement.dataset.modality = 'mouse';
    render(() => <ChannelDetailView channel={channel} />);
    expect(detail().autofocus).toBe('true');
  });

  it('leaves focus in the rail for a conversation reached by arrowing', () => {
    document.documentElement.dataset.modality = 'keyboard';
    render(() => <ChannelDetailView channel={channel} />);
    expect(detail().autofocus).toBe('false');
  });

  it('does not focus the composer on Back or Forward', () => {
    document.documentElement.dataset.modality = 'mouse';
    mocks.navigationCause = () => 'history-back';
    render(() => <ChannelDetailView channel={channel} />);
    expect(detail().autofocus).toBe('false');
  });

  it('passes each rail request only to the conversation it names', () => {
    const [request, setRequest] = createSignal<ComposerFocusRequest>();
    mocks.composerFocusRequest = request;
    const [shown, setShown] = createSignal(channel);
    render(() => <ChannelDetailView channel={shown()} />);
    expect(detail().focusRequest).toBe('0');

    setRequest({ channelId: 'channel', id: 1 });
    expect(detail().focusRequest).toBe('1');
    setRequest({ channelId: 'channel', id: 2 });
    expect(detail().focusRequest).toBe('2');

    setShown({ ...channel, id: 'other' });
    expect(detail().focusRequest).toBe('0');
  });
});
