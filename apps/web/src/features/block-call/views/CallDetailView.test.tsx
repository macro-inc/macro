import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import { CallDetailContent, useCallDetail } from './CallDetailView';

const mocks = vi.hoisted(() => ({
  setSearch: vi.fn(),
  query: {
    status: 'success',
    data: {
      callId: 'call-id',
      createdBy: 'user-id',
      guests: [],
      isActive: false,
      participants: [],
      roomName: 'room',
      shareWithTeam: false,
      startedAt: '2026-10-02T00:00:00Z',
      transcript: [],
    } satisfies CallRecord,
  },
}));

vi.mock('@app/split-router', () => ({
  createSearchParams: () => [{}, mocks.setSearch],
}));
vi.mock('../call-route', () => ({
  callDetailSearch: { namespace: 'call-detail' },
}));
vi.mock('@app/components/view-shell', () => ({ ViewShell: {} }));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  ChatWithAgentButton: () => null,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({}),
}));
vi.mock('@components/app/split-panel', () => ({ SplitPanel: {} }));
vi.mock('@core/component/SharePermissions', () => ({
  getPermissions: () => ({}),
}));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareTrigger: () => null,
}));
vi.mock('@core/component/TopBar/shareModal', () => ({
  useShareModal: () => () => {},
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@ui', () => ({ Button: () => null }));
vi.mock('../component/use-call-again', () => ({ useCallAgain: () => ({}) }));
vi.mock('@queries/call/call', () => ({
  useCallRecordQuery: () => mocks.query,
}));
vi.mock('@queries/soup/cache', () => ({
  hasSoupEntity: () => true,
  optimisticUpdateSoupItemViewedAt: vi.fn(),
  refetchSoupEntity: vi.fn(),
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: { Layout: (props: { children: JSX.Element }) => props.children },
}));
vi.mock('../component/sidepanel/CallSidePanelSections', () => ({
  CallSidePanelSections: () => null,
}));
vi.mock('../component/CallRecording/CallRecordingBody', () => ({
  CallRecordingBody: (props: {
    messageTarget?: string;
    messageTargetRequestKey?: string | number;
    onClearMessageTarget?: () => void;
  }) => (
    <button
      data-request-key={props.messageTargetRequestKey}
      onClick={props.onClearMessageTarget}
    >
      Target: {props.messageTarget || 'none'}
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('clears the route message target through the shared recording content', () => {
  const [search, setSearch] = createStore({
    messageId: 'reply-id',
    transcriptId: 'transcript-id',
    seek: 'seek-token',
  });
  mocks.setSearch.mockImplementation((patch) => {
    setSearch({ ...patch, messageId: patch.messageId ?? '' });
  });
  render(() => {
    const detail = useCallDetail(() => 'call-id');
    return (
      <CallDetailContent
        callId="call-id"
        query={detail.query}
        data={{ record: mocks.query.data, name: 'Call' }}
        messageId={search.messageId}
        transcriptId={search.transcriptId}
        seek={search.seek}
      />
    );
  });

  const target = screen.getByRole('button', { name: 'Target: reply-id' });
  expect(target.getAttribute('data-request-key')).toBe('seek-token');
  setSearch('seek', 'repeat-seek');
  expect(screen.getByRole('button', { name: 'Target: reply-id' })).toBe(target);
  expect(target.getAttribute('data-request-key')).toBe('repeat-seek');

  fireEvent.click(screen.getByRole('button', { name: 'Target: reply-id' }));

  expect(mocks.setSearch).toHaveBeenCalledWith(
    { messageId: undefined },
    { history: 'replace' }
  );
  expect(screen.getByRole('button', { name: 'Target: none' })).toBeTruthy();
  expect(search.transcriptId).toBe('transcript-id');
  expect(search.seek).toBe('repeat-seek');
});
