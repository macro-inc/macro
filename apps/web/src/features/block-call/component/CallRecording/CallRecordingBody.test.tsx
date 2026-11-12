/**
 * @vitest-environment jsdom
 */

import type { CallRecord } from '@service-call/client';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallRecordingBody } from './CallRecordingBody';

const mocks = vi.hoisted(() => ({
  callAgain: vi.fn(),
  canCallAgain: true,
  activeCallId: null as string | null,
  mobile: false,
  overlayMode: undefined as (() => boolean) | undefined,
}));

vi.mock('../use-call-again', () => ({
  useCallAgain: () => ({
    canCallAgain: () => mocks.canCallAgain,
    callAgain: mocks.callAgain,
  }),
}));
vi.mock('@channel/Call/CallContext', () => ({
  useCallContextOptional: () => ({ activeCallId: () => mocks.activeCallId }),
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  AskMacroButton: () => null,
}));
vi.mock('@property/tags', () => ({ InlineFetchedEntityTagsPill: () => null }));
vi.mock('@channel/Call/chat/CallChatHistory', () => ({
  CallDiscussionHistory: (props: {
    render: (source: unknown) => JSX.Element;
  }) => props.render({ thread: () => undefined, loading: () => false }),
}));
vi.mock('@components/app/HeaderActionGroup', () => ({
  HeaderActionGroup: () => null,
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Root: (props: { children: JSX.Element }) => props.children,
    HeaderActions: () => null,
    Layout: (props: { children: JSX.Element }) => (
      <div data-testid="panel-layout">{props.children}</div>
    ),
  },
  useSidePanel: () =>
    mocks.overlayMode
      ? { isOpen: () => false, isOverlayMode: mocks.overlayMode }
      : null,
}));
vi.mock('@core/component/CustomScrollbar', () => ({
  CustomScrollbar: () => null,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.mobile }));
vi.mock('@ui', () => ({
  Layer: (props: { children: JSX.Element }) => props.children,
  Tabs: () => null,
  Button: (props: { onClick: () => void; children: JSX.Element }) => (
    <button onClick={() => props.onClick()}>{props.children}</button>
  ),
}));
vi.mock('./CallRecordingParticipants', () => ({
  CallRecordingAvatars: () => null,
}));
vi.mock('../CallTranscript', () => ({
  CallTranscript: {
    Root: () => null,
    ScrollArea: () => null,
    Header: () => null,
    Content: () => null,
    Scrollbar: () => null,
    Sync: () => null,
  },
}));
vi.mock('./CallRecordingSummary', () => ({
  CallRecordingSummarySection: () => <p>Summary content</p>,
}));
vi.mock('./CallRecordingChat', () => ({
  CallRecordingChat: () => <p>Chat history</p>,
}));
vi.mock('./CallRecordingMobileActions', () => ({
  CallRecordingMobileActions: () => null,
}));
vi.mock('./CallRecordingMobilePlayback', () => ({
  CallRecordingMobilePlayback: () => null,
}));

function callRecord(isActive: boolean): CallRecord {
  return {
    callId: 'call-id',
    channelId: 'channel-id',
    createdBy: 'user-id',
    guests: [],
    isActive,
    participants: [],
    roomName: 'room',
    shareWithTeam: false,
    startedAt: '2026-10-28T00:00:00Z',
    transcript: [],
  } as unknown as CallRecord;
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  mocks.callAgain.mockReset();
  mocks.canCallAgain = true;
  mocks.activeCallId = null;
  mocks.mobile = false;
  mocks.overlayMode = undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CallRecordingBody join button', () => {
  it('joins an in-progress call', () => {
    render(() => (
      <CallRecordingBody record={callRecord(true)} callId="call-id" />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Join call' }));
    expect(mocks.callAgain).toHaveBeenCalledOnce();
  });

  it('hides join for an ended call', () => {
    render(() => (
      <CallRecordingBody record={callRecord(false)} callId="call-id" />
    ));
    expect(screen.queryByRole('button', { name: 'Join call' })).toBeNull();
  });

  it('hides join when already in this call', () => {
    mocks.activeCallId = 'call-id';
    render(() => (
      <CallRecordingBody record={callRecord(true)} callId="call-id" />
    ));
    expect(screen.queryByRole('button', { name: 'Join call' })).toBeNull();
  });
});

it('opens a linked message in the phone Chat tab instead of Summary', () => {
  mocks.mobile = true;
  render(() => (
    <CallRecordingBody
      record={callRecord(false)}
      callId="call-id"
      messageTarget="reply-id"
    />
  ));
  expect(screen.getByText('Chat history')).toBeTruthy();
  expect(screen.queryByText('Summary content')).toBeNull();
});

it('keeps the full-width header mounted above the panel when its mode changes', () => {
  const [overlay, setOverlay] = createSignal(false);
  mocks.overlayMode = overlay;
  const action = vi.fn();
  render(() => (
    <CallRecordingBody
      record={callRecord(false)}
      callId="call-id"
      header={() => <button onClick={action}>Header action</button>}
    />
  ));
  const header = screen.getByRole('button', { name: 'Header action' });
  expect(screen.getByTestId('panel-layout').contains(header)).toBe(false);
  setOverlay(true);
  expect(screen.getByRole('button', { name: 'Header action' })).toBe(header);
  setOverlay(false);
  expect(screen.getByRole('button', { name: 'Header action' })).toBe(header);
  fireEvent.click(header);
  expect(action).toHaveBeenCalledOnce();
});
