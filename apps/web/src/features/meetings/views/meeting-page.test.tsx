// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  MeetingPageState,
  MeetingSessionCapabilities,
} from '../context/meeting-session';
import { MeetingPage } from './meeting-page';

function setup(authenticated: boolean, autoJoin: boolean) {
  const [activeCallId, setActiveCallId] = createSignal<string | null>(null);
  const [source, setSource] = createSignal<MeetingPageState>({
    kind: 'ready',
    title: 'Design review',
    scheduledStart: null,
    scheduledEnd: null,
  });
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
      authenticated={() => authenticated}
      author={() => 'Macro Member'}
      autoJoin={autoJoin}
      url="https://macro.com/app/meet/share-token"
      onCopy={async () => undefined}
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
  return Object.assign(session, { setSource });
}

describe('public meeting prejoin', () => {
  it('requires a guest name and a deliberate join even with an autojoin URL', async () => {
    const session = setup(false, true);
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

  it('autojoins only the authenticated instant-call flow', async () => {
    const session = setup(true, true);
    await waitFor(() => expect(session.join).toHaveBeenCalledWith(undefined));
    expect(screen.queryByRole('textbox', { name: 'Your name' })).toBeNull();
  });

  it('keeps the active call and hangup control visible when its link is revoked', async () => {
    const session = setup(false, false);
    fireEvent.input(screen.getByRole('textbox', { name: 'Your name' }), {
      target: { value: 'Taylor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Join call' }));
    await screen.findByText('Connected call');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Meeting Url' }));
    await screen.findByRole('button', { name: 'Copied' });
    session.setSource({ kind: 'unavailable' });
    expect(screen.getByText('Connected call')).toBeTruthy();
    expect(screen.queryByText('This call is unavailable')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    await screen.findByText('This call is unavailable');
    expect(session.disconnect).toHaveBeenCalledOnce();
  });

  it('offers the copy action before joining', async () => {
    setup(false, false);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Meeting Url' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(screen.queryByRole('textbox', { name: 'Call link' })).toBeNull();
    expect(screen.getByText(/recorded and transcribed/)).toBeTruthy();
  });
});
