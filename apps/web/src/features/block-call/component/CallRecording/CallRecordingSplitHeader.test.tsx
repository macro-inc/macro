/** @vitest-environment jsdom */
import type { CallRecord } from '@service-call/client';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CallRecordingSplitHeader } from './CallRecordingSplitHeader';

const mocks = vi.hoisted(() => ({
  flag: () => ({ enabled: false, loading: true }),
  query: vi.fn(),
  navigate: vi.fn(),
  joinChannel: vi.fn(),
  callAgain: undefined as (() => void) | undefined,
}));
vi.mock('@app/features/meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => mocks.flag,
}));
vi.mock('@queries/call/meetings', () => ({ useCallLinkQuery: mocks.query }));
vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@channel/Call/join-channel-call', () => ({
  joinChannelCall: mocks.joinChannel,
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  ChatWithAgentButton: () => null,
  ChatWithAgentIcon: () => null,
  openChatWithAgent: () => {},
}));
vi.mock('@components/app/ResponsiveBlockToolbar', () => ({
  ResponsiveBlockToolbar: () => null,
  ResponsivePermissionsBadge: () => null,
}));
vi.mock('@components/app/split-layout/components/HeaderIsland', () => ({
  HeaderIsland: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: { children: JSX.Element }) => props.children,
  SplitHeaderRight: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  StaticSplitLabel: () => null,
}));
vi.mock('@core/block', () => ({ useBlockId: () => 'call-1' }));
vi.mock('@core/component/LiveIndicators', () => ({
  BlockLiveIndicators: () => null,
}));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  getShareDrawerRecipientInput: () => undefined,
  ShareTrigger: () => null,
  useShareDialogContext: () => ({ open: () => {} }),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@entity', () => ({ buildEntityData: () => undefined }));
vi.mock('@ui', () => ({
  Button: (props: { tooltip: string; onClick: () => void }) => {
    mocks.callAgain = props.onClick;
    return <button onClick={props.onClick}>{props.tooltip}</button>;
  },
}));

function record(channelId: string | null): CallRecord {
  return {
    callId: 'call-1',
    channelId,
    createdBy: 'macro|owner@example.com',
    isActive: false,
    participants: [],
    guests: [],
    roomName: 'room-1',
    shareWithTeam: false,
    startedAt: '2026-09-24T12:00:00Z',
    transcript: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callAgain = undefined;
  mocks.query.mockReturnValue({
    isSuccess: true,
    data: { shareToken: 'meeting-token' },
  });
});
afterEach(cleanup);

it('gates standalone Call Again queries, cached links, and stale actions reactively', () => {
  const [flag, setFlag] = createSignal({ enabled: true, loading: true });
  mocks.flag = flag;
  render(() => <CallRecordingSplitHeader record={() => record(null)} />);
  const requestedCallId = mocks.query.mock.calls[0][0];
  expect(requestedCallId()).toBeUndefined();
  expect(screen.queryByRole('button', { name: 'Call Again' })).toBeNull();
  setFlag({ enabled: false, loading: false });
  expect(requestedCallId()).toBeUndefined();
  expect(screen.queryByRole('button', { name: 'Call Again' })).toBeNull();

  setFlag({ enabled: true, loading: false });
  expect(requestedCallId()).toBe('call-1');
  fireEvent.click(screen.getByRole('button', { name: 'Call Again' }));
  expect(mocks.navigate).toHaveBeenCalledWith('/meet/join/meeting-token');
  const staleAction = mocks.callAgain;
  mocks.navigate.mockClear();

  setFlag({ enabled: false, loading: false });
  expect(requestedCallId()).toBeUndefined();
  expect(screen.queryByRole('button', { name: 'Call Again' })).toBeNull();
  staleAction?.();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it('keeps channel Call Again available while quick calls are loading or disabled', () => {
  const [flag, setFlag] = createSignal({ enabled: true, loading: true });
  mocks.flag = flag;
  render(() => <CallRecordingSplitHeader record={() => record('channel-1')} />);
  const requestedCallId = mocks.query.mock.calls[0][0];
  expect(requestedCallId()).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Call Again' }));
  setFlag({ enabled: false, loading: false });
  fireEvent.click(screen.getByRole('button', { name: 'Call Again' }));
  expect(mocks.joinChannel).toHaveBeenCalledTimes(2);
  expect(mocks.joinChannel).toHaveBeenCalledWith('channel-1');
  expect(mocks.navigate).not.toHaveBeenCalled();
});
