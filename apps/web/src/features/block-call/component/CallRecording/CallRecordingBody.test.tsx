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
    joinCall: mocks.callAgain,
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
vi.mock('./CallRecordingControls', () => ({
  CallRecordingControls: () => null,
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
    sessions: [],
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
  vi.restoreAllMocks();
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

describe('CallRecordingBody parts', () => {
  const PART_1 = 'https://recordings.example/part-1.mp4';
  const PART_2 = 'https://recordings.example/part-2.mp4';
  function twoPartRecord(): CallRecord {
    return {
      ...callRecord(false),
      recordingUrl: PART_1,
      recordingStartedAt: '2026-10-28T00:00:00Z',
      sessions: [
        {
          startedAt: '2026-10-28T00:00:00Z',
          endedAt: '2026-10-28T00:20:00Z',
          recordingStartedAt: '2026-10-28T00:00:00Z',
          recordingUrl: PART_1,
        },
        {
          startedAt: '2026-10-28T00:30:00Z',
          endedAt: '2026-10-28T00:50:00Z',
          recordingStartedAt: '2026-10-28T00:30:00Z',
          recordingUrl: PART_2,
        },
      ],
      transcript: [
        {
          transcriptId: 'line-1',
          sequenceNum: 1,
          startedAt: '2026-10-28T00:05:00Z',
          content: 'first part',
          speakerId: 'user-id',
        },
        {
          transcriptId: 'line-2',
          sequenceNum: 2,
          startedAt: '2026-10-28T00:40:00Z',
          content: 'second part',
          speakerId: 'user-id',
        },
      ],
    };
  }
  // A recording mounts the player, whose layout observes its visibility.
  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });
  const video = () => {
    const element = document.querySelector('video');
    if (!element) throw new Error('expected the recording video');
    return element;
  };

  it('plays the next part on the same video when a part ends', () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    render(() => (
      <CallRecordingBody record={twoPartRecord()} callId="call-id" />
    ));
    const element = video();
    expect(element.getAttribute('src')).toBe(PART_1);

    // Playback reaching the end pauses at the end, then ends.
    Object.defineProperty(element, 'ended', {
      configurable: true,
      get: () => true,
    });
    fireEvent(element, new Event('pause'));
    fireEvent(element, new Event('ended'));

    expect(video()).toBe(element);
    expect(element.getAttribute('src')).toBe(PART_2);
    expect(play).toHaveBeenCalledOnce();
  });

  it('stays on a part when a paused seek reaches its end', () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    render(() => (
      <CallRecordingBody record={twoPartRecord()} callId="call-id" />
    ));

    // A paused seek to the end fires `ended` without a `pause`.
    fireEvent(video(), new Event('ended'));

    expect(video().getAttribute('src')).toBe(PART_1);
    expect(play).not.toHaveBeenCalled();
  });

  it('opens the part of a linked transcript line before seeking into it', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const seeks: { src: string | null; seconds: number }[] = [];
    vi.spyOn(
      HTMLMediaElement.prototype,
      'currentTime',
      'set'
    ).mockImplementation(function (this: HTMLMediaElement, seconds: number) {
      seeks.push({ src: this.getAttribute('src'), seconds });
    });
    render(() => (
      <CallRecordingBody
        record={twoPartRecord()}
        callId="call-id"
        transcriptTarget={{ transcriptId: 'line-2', gen: 1 }}
      />
    ));

    expect(video().getAttribute('src')).toBe(PART_2);
    // Ten minutes into the second part's recording, on the second source.
    expect(seeks.at(-1)).toEqual({ src: PART_2, seconds: 600 });
  });
});
