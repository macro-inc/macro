// @vitest-environment jsdom
import { render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MeetingRouteContent } from './meeting-route';

const state = vi.hoisted(() => ({
  authenticated: false,
  recordCallId: '',
  credentials: { token: 'guest-token', participantId: 'guest-1' },
}));

vi.mock('@core/context/user', () => ({
  useIsAuthenticated: () => () => state.authenticated,
  useAuthor: () => () => 'Participant',
  useUserId: () => () => (state.authenticated ? 'member-1' : undefined),
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@channel/Call/CallContext', () => ({
  useCallContext: () => ({
    activeCallId: () => 'call-1',
    isInCall: () => true,
    backgroundEffect: () => undefined,
  }),
}));
vi.mock('@solidjs/router', () => ({
  useSearchParams: () => [{}],
  useLocation: () => ({ pathname: '/meet/call', search: '' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@queries/call/call', () => ({
  useCallRecordQuery: (callId: () => string) => {
    state.recordCallId = callId();
    return {
      isPending: false,
      isLoadingError: false,
      isSuccess: true,
      data: {
        callId: 'call-1',
        channelId: 'channel-1',
        channelName: 'Channel',
        userAccessLevel: 'edit',
        discussion: {
          kind: 'channel_thread',
          channel_id: 'channel-1',
          root_id: 'call-1',
        },
      },
    };
  },
}));
vi.mock('@queries/call/meetings', () => ({
  useMeetingQuery: () => ({
    isSuccess: true,
    data: { id: 'meeting-1', channelId: null, callId: 'call-1' },
  }),
  useMeetingParticipantsQuery: () => ({ isSuccess: false, isError: false }),
  useJoinMeetingMutation: () => ({ mutateAsync: vi.fn() }),
  useUpdateMeetingMutation: () => ({ mutateAsync: vi.fn() }),
  leaveMeeting: vi.fn(),
}));
vi.mock('./context/meeting-session-lifecycle', () => ({
  useMeetingSessionLifecycle: () => ({}),
}));
vi.mock('./browser/meeting-media', () => ({ browserMeetingMedia: {} }));
vi.mock('./browser/meeting-runtime', () => ({
  preloadMeetingRuntime: vi.fn(),
}));
vi.mock('./views/meeting-page', () => ({
  MeetingPage: (props: {
    renderCall: (
      onLeave: () => void,
      name: () => string,
      credentials: () => typeof state.credentials,
      copyButton: JSX.Element
    ) => JSX.Element;
  }) =>
    props.renderCall(
      () => undefined,
      () => 'Participant',
      () => state.credentials,
      <div />
    ),
}));
vi.mock('@channel/Call/CallOverlay', () => ({
  CallOverlay: (props: {
    discussion: {
      render: (panel: {
        open: boolean;
        focusOnOpen: boolean;
        onClose: () => void;
      }) => JSX.Element;
    };
  }) =>
    props.discussion.render({
      open: true,
      focusOnOpen: false,
      onClose: () => undefined,
    }),
}));
vi.mock('@channel/Call/discussion/CallDiscussionContent', () => ({
  CallDiscussionContent: (props: {
    discussion: () => { kind: string } | undefined;
    access: { kind: string };
  }) => (
    <div
      data-testid="discussion"
      data-kind={props.discussion()?.kind}
      data-access={props.access.kind}
    />
  ),
}));

afterEach(() => {
  state.authenticated = false;
});

it('uses guest call chat without reading the private call record', () => {
  render(() => (
    <MeetingRouteContent
      shareToken="share-token"
      onCallStateChange={() => undefined}
      onLeave={() => undefined}
    />
  ));

  expect(state.recordCallId).toBe('');
  expect(screen.getByTestId('discussion').dataset).toMatchObject({
    kind: 'call_chat',
    access: 'guest',
  });
});

it('uses the stored channel discussion for a member', () => {
  state.authenticated = true;
  render(() => (
    <MeetingRouteContent
      shareToken="share-token"
      onCallStateChange={() => undefined}
      onLeave={() => undefined}
    />
  ));

  expect(state.recordCallId).toBe('call-1');
  expect(screen.getByTestId('discussion').dataset).toMatchObject({
    kind: 'channel_thread',
    access: 'member',
  });
});
