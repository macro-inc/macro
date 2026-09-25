// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  MeetingCredentials,
  MeetingMediaPreferences,
  MeetingMediaSource,
} from '../context/meeting-session';
import { createMeetingSessionLifecycle } from '../primitives/meeting-session-lifecycle';
import { fakeMediaAccess, stubMediaStream } from '../tests/fake-media';
import { MeetingPage } from './meeting-page';

const credentials: MeetingCredentials = {
  callId: 'call-1',
  channelId: null,
  roomName: 'room-1',
  serverUrl: 'wss://example.com',
  token: 'rtc-token',
  participantId: 'macro|host@example.com',
  shareToken: 'meeting-secret',
};

beforeEach(stubMediaStream);
afterEach(cleanup);

it('keeps the device toggles live while joining and publishes the state chosen at connect time', async () => {
  const { request, tracks } = fakeMediaAccess();
  let issueToken!: (value: MeetingCredentials) => void;
  const join = vi.fn(
    () =>
      new Promise<MeetingCredentials>((resolve) => {
        issueToken = resolve;
      })
  );
  let activeCallId: string | null = null;
  let claimed: MeetingMediaPreferences | undefined;
  const connect = vi.fn(
    async (_: MeetingCredentials, media: MeetingMediaSource) => {
      claimed = media();
      activeCallId = credentials.callId;
    }
  );
  render(() => (
    <MeetingPage
      source={() => ({
        kind: 'ready',
        title: 'Quick Call',
        channelId: null,
        scheduledStart: null,
        scheduledEnd: null,
      })}
      authenticated={() => true}
      author={() => 'Host'}
      onCopy={async () => {}}
      mediaAccess={{ request }}
      session={{
        lifecycle: createMeetingSessionLifecycle(),
        shareToken: () => 'meeting-secret',
        isInCall: () => activeCallId !== null,
        activeCallId: () => activeCallId,
        join,
        release: async () => {},
        connect,
        disconnect: async () => {
          activeCallId = null;
        },
      }}
      renderCall={() => <div>Connected</div>}
    />
  ));
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  const [microphone] = tracks;
  const microphoneToggle = screen.getByRole<HTMLInputElement>('switch', {
    name: 'Microphone',
  });
  const cameraToggle = screen.getByRole<HTMLInputElement>('switch', {
    name: 'Camera',
  });

  fireEvent.click(screen.getByRole('button', { name: 'Join call' }));
  await vi.waitFor(() => expect(join).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: 'Joining…' })).toBeTruthy();
  expect(microphoneToggle.disabled).toBe(false);
  expect(cameraToggle.disabled).toBe(false);
  // The preview keeps its devices until the call claims them.
  expect(microphone.stop).not.toHaveBeenCalled();

  fireEvent.click(microphoneToggle);
  await vi.waitFor(() => expect(microphoneToggle.checked).toBe(false));
  expect(microphone.stop).toHaveBeenCalledOnce();

  issueToken(credentials);
  await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
  expect(claimed).toEqual({
    microphoneEnabled: false,
    cameraEnabled: false,
    localTracks: undefined,
  });
  await screen.findByText('Connected');
});
