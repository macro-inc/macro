/** @vitest-environment jsdom */
import type { CallState } from '@channel/Call/CallContext';
import { isMeetingPath } from '@channel/Call/call-link';
import { queryClient } from '@queries/client';
import {
  createMemoryHistory,
  MemoryRouter,
  Route,
  type RouteSectionProps,
  useLocation,
} from '@solidjs/router';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import userEvent from '@testing-library/user-event';
import { ok } from 'neverthrow';
import { createResource, createSignal, Show, Suspense } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPreviewCallState } from './debug/preview-call-state';
import { MeetingRouter } from './meeting-router';
import { MeetingSessionProvider } from './meeting-session-provider';
import { fakeMediaAccess, stubMediaStream } from './tests/fake-media';

// Imported app services may construct sockets at module load. Keep every
// transport offline; the RTC/media boundary below is an in-memory controller.
vi.hoisted(() => {
  vi.stubGlobal(
    'WebSocket',
    class extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 3;
      send() {}
      close() {}
    }
  );
});

const mocks = vi.hoisted(() => ({
  call: undefined as CallState | undefined,
  createMeeting: vi.fn(),
  joinMeeting: vi.fn(),
  leaveMeeting: vi.fn(),
  getMeeting: vi.fn(),
  getCallRecord: vi.fn(),
  getTeam: vi.fn(),
}));

vi.mock('@service-call/client', () => ({ callServiceClient: mocks }));
vi.mock('@service-auth/client', () => ({ authServiceClient: mocks }));
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: () => {},
  createConnectionBlockWebsocketEffect: () => {},
  ws: {
    addEventListener: () => {},
    removeEventListener: () => {},
    send: () => {},
  },
  state: () => 'closed',
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
vi.mock('@channel/Call/CallContext', () => ({
  useCallContext: () => mocks.call,
  BACKGROUND_IMAGES: [],
}));
vi.mock('@core/context/user', () => ({
  useAuthor: () => () => 'Call owner',
  useIsAuthenticated: () => () => true,
  useUserId: () => () => 'macro|owner@example.com',
}));
vi.mock('@core/user', async () => ({
  ...(await import('@core/user/macroId')),
  getDisplayName: () => 'Call owner',
}));
vi.mock('@core/user/util', () => ({ idToDisplayName: () => 'Call owner' }));
vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => <span>Owner avatar</span>,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));

const credentials = {
  callId: 'call-1',
  channelId: null,
  roomName: 'room-1',
  serverUrl: 'wss://example.com',
  token: 'rtc-token',
  participantId: 'macro|owner@example.com',
  shareToken: 'meeting-token',
};
const originalMediaDevices = Object.getOwnPropertyDescriptor(
  navigator,
  'mediaDevices'
);

beforeEach(() => {
  vi.clearAllMocks();
  stubMediaStream();
  vi.stubGlobal('scrollTo', vi.fn());
  mocks.createMeeting.mockResolvedValue(
    ok({ id: 'meeting-1', shareToken: 'meeting-token' })
  );
  mocks.joinMeeting.mockResolvedValue(ok(credentials));
  mocks.leaveMeeting.mockResolvedValue(ok(undefined));
  mocks.getMeeting.mockResolvedValue(
    ok({
      id: 'meeting-1',
      shareToken: 'meeting-token',
      title: 'Owner call',
      scheduledStart: null,
      scheduledEnd: null,
      channelId: null,
      callId: null,
    })
  );
  mocks.getCallRecord.mockResolvedValue(
    ok({
      callId: 'call-1',
      channelId: null,
      createdBy: 'macro|owner@example.com',
      userAccessLevel: 'owner',
    })
  );
  mocks.getTeam.mockResolvedValue(ok(null));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
  if (originalMediaDevices)
    Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

function setup(path: string, delayDisconnect = false) {
  const [activeCallId, setActiveCallId] = createSignal<string | null>(null);
  const { request } = fakeMediaAccess();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: request },
  });
  const history = createMemoryHistory();
  history.set({ value: '/app/calendar', replace: true });
  history.set({ value: `/app${path}` });
  let finishDisconnect = () => {};
  const disconnect = vi.fn(async () => {
    setActiveCallId(null);
    if (delayDisconnect)
      await new Promise<void>((resolve) => {
        finishDisconnect = resolve;
      });
  });
  let finishHome!: () => void;
  const home = new Promise<boolean>((resolve) => {
    finishHome = () => resolve(true);
  });

  // Mirrors AppRouteLayout's focused meeting shell: entering Macro changes the
  // wrapper while its destination can still be waiting on data under Suspense.
  function Shell(props: RouteSectionProps) {
    const location = useLocation();
    return (
      <Suspense fallback={<div>Loading destination</div>}>
        <Show
          when={!isMeetingPath(location.pathname)}
          fallback={props.children}
        >
          <div data-testid="app-shell">{props.children}</div>
        </Show>
      </Suspense>
    );
  }
  function Home() {
    const [ready] = createResource(() => home);
    return <div>{ready()}Macro home</div>;
  }
  function Harness() {
    mocks.call = {
      ...createPreviewCallState(),
      activeCallId,
      isInCall: () => activeCallId() !== null,
      remoteParticipants: () => new Map(),
      connectSession: vi.fn(async () => {
        setActiveCallId('call-1');
      }),
      disconnectSession: disconnect,
    };
    return (
      <QueryClientProvider client={queryClient}>
        <MeetingSessionProvider>
          <MemoryRouter base="/app" history={history} root={Shell}>
            <Route path="/meet/*path" component={MeetingRouter} />
            <Route path="/" component={Home} />
            <Route path="/calendar" component={() => <div>Calendar</div>} />
          </MemoryRouter>
        </MeetingSessionProvider>
      </QueryClientProvider>
    );
  }
  render(Harness);
  return {
    history,
    request,
    disconnect,
    setActiveCallId,
    finishHome,
    finishDisconnect: () => finishDisconnect(),
  };
}

it.each([
  ['/meet/new', 'Start call', false],
  ['/meet/new', 'Start call', true],
  ['/meet/join/meeting-token', 'Join call', true],
] as const)(
  'leaves %s after %s using real controls (delayed cleanup: %s)',
  async (path, action, delayDisconnect) => {
    const state = setup(path, delayDisconnect);
    const start = await screen.findByRole('button', { name: action });
    await waitFor(() => expect(start).toHaveProperty('disabled', false));
    fireEvent.click(start);
    const leave = await screen.findByRole('button', { name: 'Leave call' });
    await waitFor(() =>
      expect(state.history.get()).toBe('/app/meet/meeting-token')
    );
    expect(mocks.joinMeeting).toHaveBeenCalledOnce();
    expect(state.request).toHaveBeenCalledOnce();

    fireEvent.click(leave);
    await waitFor(() => expect(state.disconnect).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'Rejoin call' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Camera' })).toBeNull();
    state.finishHome();
    await screen.findByText('Macro home');
    await waitFor(() => expect(state.history.get()).toBe('/app'));
    state.finishDisconnect();
    await waitFor(() =>
      expect(mocks.leaveMeeting).toHaveBeenCalledExactlyOnceWith(
        'meeting-token',
        'rtc-token'
      )
    );
    expect(state.request).toHaveBeenCalledOnce();
    expect(mocks.joinMeeting).toHaveBeenCalledOnce();
    expect(state.history.get()).toBe('/app');

    state.history.back();
    await screen.findByText('Calendar');
    expect(state.history.get()).toBe('/app/calendar');
  }
);

it('keeps an unexpected RTC disconnect in the existing setup for retry', async () => {
  const state = setup('/meet/new');
  const start = await screen.findByRole('button', { name: 'Start call' });
  await waitFor(() => expect(start).toHaveProperty('disabled', false));
  fireEvent.click(start);
  await screen.findByRole('button', { name: 'Leave call' });
  await waitFor(() =>
    expect(state.history.get()).toBe('/app/meet/meeting-token')
  );

  state.setActiveCallId(null);
  await screen.findByText('You were disconnected. Join again to reconnect.');
  await waitFor(() =>
    expect(state.history.get()).toBe('/app/meet/join/meeting-token')
  );
  expect(state.disconnect).not.toHaveBeenCalled();
  expect(mocks.createMeeting).toHaveBeenCalledOnce();
});

it('waits for the old route owner to release before rejoining the same call', async () => {
  let finishRelease!: () => void;
  const releasePending = new Promise<void>((resolve) => {
    finishRelease = resolve;
  });
  mocks.leaveMeeting.mockImplementationOnce(async () => {
    await releasePending;
    return ok(undefined);
  });
  const state = setup('/meet/join/meeting-token');
  try {
    await userEvent.click(
      await screen.findByRole('button', { name: 'Join call' })
    );
    const leave = await screen.findByRole('button', { name: 'Leave call' });
    expect(mocks.joinMeeting).toHaveBeenCalledOnce();

    fireEvent.click(leave);
    state.finishHome();
    await screen.findByText('Macro home');
    await waitFor(() => expect(mocks.leaveMeeting).toHaveBeenCalledOnce());
    expect(state.history.get()).toBe('/app');

    state.history.set({ value: '/app/meet/join/meeting-token' });
    const rejoin = await screen.findByRole('button', { name: 'Join call' });
    await waitFor(() => expect(rejoin).toHaveProperty('disabled', false));
    await userEvent.click(rejoin);

    // The previous page has unmounted, but its participant release still owns
    // this identity. A new credential request must wait for that release.
    expect(mocks.joinMeeting).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Joining…' })).toBeTruthy();
    finishRelease();
    await screen.findByRole('button', { name: 'Leave call' });
    expect(mocks.joinMeeting).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(state.history.get()).toBe('/app/meet/meeting-token')
    );
  } finally {
    finishRelease();
  }
});
