// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  MeetingPageState,
  MeetingSessionCapabilities,
} from '../context/meeting-session';
import type { MeetingMediaAccess } from '../primitives/meeting-media';
import { MeetingPage } from './meeting-page';

function setup(
  authenticated: boolean,
  startCall: boolean,
  options?: { mediaAccess?: MeetingMediaAccess; channelId?: string | null }
) {
  const [signedIn, setSignedIn] = createSignal(authenticated);
  const [activeCallId, setActiveCallId] = createSignal<string | null>(null);
  const [source, setSource] = createSignal<MeetingPageState>({
    kind: 'ready',
    title: 'Design review',
    scheduledStart: null,
    scheduledEnd: null,
    channelId: options?.channelId ?? null,
  });
  const onSignIn = vi.fn();
  const session: MeetingSessionCapabilities = {
    shareToken: () => 'share-token',
    activeCallId,
    isInCall: () => activeCallId() !== null,
    join: vi.fn(async () => ({
      callId: 'call-1',
      channelId: null,
      roomName: 'room-1',
      serverUrl: 'wss://example.com',
      token: 'rtc-token',
      participantId: 'guest-1',
      shareToken: 'share-token',
    })),
    release: vi.fn(async () => undefined),
    connect: vi.fn(async () => {
      setActiveCallId('call-1');
    }),
    disconnect: vi.fn(async () => {
      setActiveCallId('call-1');
    }),
  };
  render(() => (
    <MeetingPage
      source={source}
      session={session}
      mediaAccess={options?.mediaAccess}
      authenticated={signedIn}
      author={() => 'Macro Member'}
      startCall={startCall}
      url="https://macro.com/app/meet/share-token"
      onCopy={async () => undefined}
      onSignIn={onSignIn}
      renderCall={(onLeave) => (
        <div>
          Connected call
          <button type="button" onClick={onLeave}>
            Leave call
          </button>
        </div>
      )}
    />
  ));
  return Object.assign(session, { setSource, setSignedIn, onSignIn });
}

describe('public meeting prejoin', () => {
  it('checks devices before joining and never joins from a permission grant', async () => {
    const stop = vi.fn();
    const request = vi.fn(
      async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream
    );
    const session = setup(true, true, { mediaAccess: { request } });
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('button', { name: 'Start call' })).toHaveProperty(
        'disabled',
        false
      );
    });
    expect(session.join).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('switch', { name: 'Camera' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Camera preview')).toHaveProperty(
        'srcObject',
        expect.anything()
      )
    );
    expect(session.join).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start call' }));
    await screen.findByText('Connected call');
    expect(stop).toHaveBeenCalledTimes(3);
    expect(session.connect).toHaveBeenCalledWith(expect.anything(), {
      microphoneEnabled: true,
      cameraEnabled: true,
    });
  });

  it('requires a guest name and a deliberate join', async () => {
    const session = setup(false, false);
    expect(session.join).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Join call' })).toHaveProperty(
      'disabled',
      true
    );
    fireEvent.input(screen.getByRole('textbox', { name: 'Your name' }), {
      target: { value: 'Taylor' },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Microphone' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Camera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Join call' }));
    await waitFor(() => expect(session.join).toHaveBeenCalledWith('Taylor'));
    expect(session.connect).toHaveBeenCalledWith(expect.anything(), {
      microphoneEnabled: false,
      cameraEnabled: true,
    });
  });

  it.each([true, false])(
    'waits for a click after loading and authentication (creator: %s)',
    async (creator) => {
      const session = setup(false, creator);
      session.setSource({ kind: 'loading' });
      session.setSignedIn(true);
      session.setSource({
        kind: 'ready',
        title: 'Design review',
        scheduledStart: null,
        scheduledEnd: null,
        channelId: null,
      });
      const button = await screen.findByRole('button', {
        name: creator ? 'Start call' : 'Join call',
      });
      expect(session.join).not.toHaveBeenCalled();
      expect(session.connect).not.toHaveBeenCalled();
      expect(screen.queryByText('Connected call')).toBeNull();
      fireEvent.click(screen.getByRole('switch', { name: 'Microphone' }));
      fireEvent.click(screen.getByRole('switch', { name: 'Camera' }));
      fireEvent.click(button);
      await screen.findByText('Connected call');
      expect(session.join).toHaveBeenCalledExactlyOnceWith(undefined);
      expect(session.connect).toHaveBeenCalledWith(expect.anything(), {
        microphoneEnabled: false,
        cameraEnabled: true,
      });
    }
  );

  it('keeps the active call and hangup control visible when its link is revoked', async () => {
    const session = setup(false, false);
    fireEvent.input(screen.getByRole('textbox', { name: 'Your name' }), {
      target: { value: 'Taylor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join call' }));
    await screen.findByText('Connected call');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Meeting Url' }));
    await screen.findByText('Meeting URL copied');
    session.setSource({ kind: 'unavailable' });
    expect(screen.getByText('Connected call')).toBeTruthy();
    expect(screen.queryByText('This call is unavailable')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    await screen.findByText('This call is unavailable');
    expect(session.disconnect).toHaveBeenCalledOnce();
  });

  it('gates channel-linked calls behind sign-in instead of the guest form', async () => {
    const session = setup(false, false, { channelId: 'channel-1' });
    expect(
      screen.getByText('This call is for Macro members. Sign in to join.')
    ).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Your name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Join call' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(session.onSignIn).toHaveBeenCalledOnce();
    expect(session.join).not.toHaveBeenCalled();

    // A signed-in member gets the normal join flow.
    session.setSignedIn(true);
    const button = await screen.findByRole('button', { name: 'Join call' });
    expect(
      screen.queryByText('This call is for Macro members. Sign in to join.')
    ).toBeNull();
    fireEvent.click(button);
    await screen.findByText('Connected call');
    expect(session.join).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('offers the copy action before joining', async () => {
    setup(false, false);
    expect(
      screen.getByRole('link', { name: 'Back to Macro' }).getAttribute('href')
    ).toBe('/app');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Meeting Url' }));
    await screen.findByText('Meeting URL copied');
    expect(screen.queryByRole('textbox', { name: 'Call link' })).toBeNull();
    expect(screen.getByText(/recorded and transcribed/)).toBeTruthy();
  });
});
