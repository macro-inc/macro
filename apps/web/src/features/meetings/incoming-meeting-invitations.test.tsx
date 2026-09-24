/** @vitest-environment jsdom */
import { callKeys } from '@queries/call/keys';
import { queryClient } from '@queries/client';
import type { ActiveMeeting } from '@service-call/client';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveCallsSidebar } from './components/live-calls-sidebar';
import type { MeetingInvitation } from './core/meeting-invitations';
import { IncomingMeetingInvitationsProvider } from './incoming-meeting-invitations';
import { useActiveQuickCallsSource } from './queries/active-quick-calls';

const mocks = vi.hoisted(() => ({
  flag: () => ({ enabled: true, loading: false }),
  events: vi.fn(),
  resolutions: vi.fn(),
  publish: vi.fn(),
  ring: vi.fn(),
  stop: vi.fn(),
  navigate: vi.fn(),
  callerName: vi.fn(),
  getActiveMeetings: vi.fn(),
}));
vi.mock('./use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => mocks.flag,
}));
vi.mock('@service-call/client', () => ({ callServiceClient: mocks }));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|recipient@example.com',
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@notifications', () => ({
  usePlatformNotificationState: () => 'not-supported',
}));
vi.mock('@notifications/notification-resolvers', () => ({
  DefaultUserNameResolver: mocks.callerName,
}));
vi.mock('@channel/Call/CallStartedNotifier', () => ({
  startCallRinger: mocks.ring,
}));
vi.mock('@channel/Call/meeting-invitation-events', () => ({
  createMeetingInvitationEventsEffect: mocks.events,
}));
vi.mock('@channel/Call/meeting-invitation-resolution', () => ({
  publishMeetingInvitationResolution: mocks.publish,
  subscribeToMeetingInvitationResolutions: mocks.resolutions,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flag = () => ({ enabled: true, loading: false });
  mocks.ring.mockReturnValue({ stop: mocks.stop });
  mocks.resolutions.mockReturnValue(vi.fn());
  mocks.callerName.mockResolvedValue('Ada');
  mocks.getActiveMeetings.mockResolvedValue(ok([]));
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function LiveCalls() {
  const source = useActiveQuickCallsSource(() => 'macro|recipient@example.com');
  return (
    <LiveCallsSidebar
      calls={source.calls().map((call) => ({ ...call, label: call.title }))}
      onJoin={() => {}}
    />
  );
}

function setup(withLiveCalls = false) {
  render(() => (
    <QueryClientProvider client={queryClient}>
      <IncomingMeetingInvitationsProvider>
        <main>
          <input aria-label="Current work" />
          <Show when={withLiveCalls}>
            <LiveCalls />
          </Show>
        </main>
      </IncomingMeetingInvitationsProvider>
    </QueryClientProvider>
  ));
  const input = screen.getByRole('textbox', { name: 'Current work' });
  input.focus();
  return input;
}

async function invite() {
  const event: MeetingInvitation = {
    meetingId: 'meeting-1',
    shareToken: 'meeting-token',
    title: 'Planning',
    createdBy: 'macro|ada@example.com',
    invitedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
  };
  mocks.events.mock.calls.at(-1)![0].onInvited(event);
  // Let the caller name resolve without depending on notification permission.
  await Promise.resolve();
  await Promise.resolve();
  return event;
}

it('shows Join and Decline without a sidebar or OS notifications and joins through the meeting route', async () => {
  const input = setup();
  await invite();
  expect(mocks.ring).toHaveBeenCalledOnce();
  expect(screen.getByRole('region', { name: 'Incoming calls' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Planning' })).toBeTruthy();
  expect(screen.getByText('Ada is calling you')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Decline Planning call' })
  ).toBeTruthy();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(
    screen.queryByRole('button', { name: /microphone|camera/i })
  ).toBeNull();
  expect(document.activeElement).toBe(input);

  fireEvent.click(screen.getByRole('button', { name: 'Join Planning call' }));
  expect(mocks.navigate).toHaveBeenCalledWith('/meet/join/meeting-token');
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(screen.queryByRole('region', { name: 'Incoming calls' })).toBeNull();
  expect(mocks.publish).toHaveBeenCalledWith(
    expect.objectContaining({
      meetingId: 'meeting-1',
      userId: 'macro|recipient@example.com',
    })
  );
});

it('refreshes server invite eligibility, keeps the live call after Decline, and removes it when ended', async () => {
  const otherAccountKey = [
    ...callKeys.activeMeetings.queryKey,
    'macro|other@example.com',
  ];
  queryClient.setQueryData(otherAccountKey, []);
  setup(true);
  await waitFor(() => expect(mocks.getActiveMeetings).toHaveBeenCalledOnce());
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  expect(screen.queryByRole('region', { name: 'Live' })).toBeNull();

  const live: ActiveMeeting = {
    id: 'meeting-1',
    callId: 'live-call-1',
    createdBy: 'macro|ada@example.com',
    shareToken: 'meeting-token',
    title: 'Planning',
    channelId: null,
    scheduledStart: null,
    scheduledEnd: null,
  };
  mocks.getActiveMeetings.mockResolvedValue(ok([live]));
  await invite();
  await screen.findByRole('region', { name: 'Live' });
  expect(mocks.getActiveMeetings).toHaveBeenCalledTimes(2);
  expect(queryClient.getQueryState(otherAccountKey)?.isInvalidated).toBe(false);

  fireEvent.click(
    screen.getByRole('button', { name: 'Decline Planning call' })
  );
  expect(screen.queryByRole('region', { name: 'Incoming calls' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Live' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Join Planning' })).toBeTruthy();
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.navigate).not.toHaveBeenCalled();

  // The list remains authoritative: once the live session ends, no local
  // invitation or dismissal state may retain its row after the next refresh.
  mocks.getActiveMeetings.mockResolvedValue(ok([]));
  await queryClient.refetchQueries({
    queryKey: callKeys.activeMeetings.queryKey,
  });
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Live' })).toBeNull()
  );
});

it('declines from the global notification and resolves the ring without navigating', async () => {
  setup();
  const event = await invite();
  fireEvent.click(
    screen.getByRole('button', { name: 'Decline Planning call' })
  );
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.publish).toHaveBeenCalledExactlyOnceWith({
    meetingId: event.meetingId,
    userId: 'macro|recipient@example.com',
    resolvedAt: event.invitedAt,
  });
  expect(screen.queryByRole('region', { name: 'Incoming calls' })).toBeNull();
});

it('keeps the focused Join button mounted while the caller name resolves', async () => {
  let resolveName!: (name: string) => void;
  mocks.callerName.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      resolveName = resolve;
    })
  );
  setup();
  await invite();
  const join = screen.getByRole('button', { name: 'Join Planning call' });
  join.focus();

  resolveName('Ada');
  await Promise.resolve();
  await Promise.resolve();

  expect(screen.getByText('Ada is calling you')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Join Planning call' })).toBe(join);
  expect(document.activeElement).toBe(join);
});

it('removes the global notification when the invitation expires', async () => {
  vi.useFakeTimers();
  setup();
  await invite();
  vi.advanceTimersByTime(29_000);
  expect(
    screen.getByRole('button', { name: 'Join Planning call' })
  ).toBeTruthy();
  vi.advanceTimersByTime(1000);
  expect(screen.queryByRole('region', { name: 'Incoming calls' })).toBeNull();
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it('removes the global notification only when this recipient answers elsewhere', async () => {
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  setup();
  await invite();
  invalidate.mockClear();
  const events = mocks.events.mock.calls[0][0];
  events.onAnswered({
    meetingId: 'meeting-1',
    userId: 'macro|other@example.com',
  });
  expect(
    screen.getByRole('button', { name: 'Join Planning call' })
  ).toBeTruthy();
  expect(invalidate).not.toHaveBeenCalled();
  events.onAnswered({
    meetingId: 'meeting-1',
    userId: 'macro|recipient@example.com',
  });
  expect(screen.queryByRole('region', { name: 'Incoming calls' })).toBeNull();
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({
    queryKey: [
      ...callKeys.activeMeetings.queryKey,
      'macro|recipient@example.com',
    ],
  });
});

it('gates quick-call listeners and stops active rings without remounting app content', async () => {
  const [flag, setFlag] = createSignal({ enabled: true, loading: true });
  mocks.flag = flag;
  const input = setup() as HTMLInputElement;
  fireEvent.input(input, { target: { value: 'Keep my work' } });
  expect(mocks.events).not.toHaveBeenCalled();
  expect(mocks.resolutions).not.toHaveBeenCalled();
  expect(mocks.ring).not.toHaveBeenCalled();

  setFlag({ enabled: false, loading: false });
  expect(mocks.events).not.toHaveBeenCalled();
  setFlag({ enabled: true, loading: false });
  expect(mocks.events).toHaveBeenCalledOnce();
  const invitation = await invite();
  const staleListener = mocks.events.mock.calls[0][0];
  const unsubscribe = mocks.resolutions.mock.results[0].value;
  expect(mocks.ring).toHaveBeenCalledOnce();

  setFlag({ enabled: false, loading: false });
  expect(screen.queryByRole('region', { name: 'Incoming calls' })).toBeNull();
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(screen.getByRole('textbox', { name: 'Current work' })).toBe(input);
  expect(input.value).toBe('Keep my work');
  staleListener.onInvited(invitation);
  expect(mocks.ring).toHaveBeenCalledOnce();

  setFlag({ enabled: true, loading: false });
  expect(mocks.events).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('region', { name: 'Incoming calls' })).toBeNull();
  expect(mocks.ring).toHaveBeenCalledOnce();
  await invite();
  expect(mocks.ring).toHaveBeenCalledTimes(2);
});
