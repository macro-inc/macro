/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import type { RemoteParticipant, Track } from 'livekit-client';
import { createSignal, type Setter } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallState } from '../CallContext';
import { CallOverlay } from '../CallOverlay';

const mocks = vi.hoisted(() => ({
  callContext: undefined as unknown,
  displayNames: new Map<string, string>(),
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));

vi.mock('@core/hotkey/hotkeys', () => ({ registerHotkey: vi.fn() }));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => <div data-testid="user-avatar" />,
}));

vi.mock('@core/context/user', () => ({
  useAuthor: () => () => 'Current User',
  useUserId: () => () => 'current-user',
}));

vi.mock('@core/signal/profilePicture', () => ({
  useProfilePictureUrl: () => [() => undefined],
}));

vi.mock('@core/user', () => ({
  tryMacroId: (identity: string) => identity,
  getDisplayName: (identity: string) =>
    mocks.displayNames.get(identity) ?? identity,
}));

vi.mock('../CallContext', () => ({
  useCallContext: () => mocks.callContext,
}));

vi.mock('../CallControls/CallControls', () => ({
  CallControls: () => null,
}));

vi.mock('../chat/CallChat', () => ({
  default: (props: { callId: string; open: boolean }) => (
    <section hidden={!props.open} aria-label="Call chat">
      <p>{props.callId}</p>
      <input aria-label="Message this call" />
    </section>
  ),
}));

vi.mock('../TrackView', () => ({
  TrackView: (props: { track?: { sid?: string } }) => (
    <div data-testid={`track-${props.track?.sid ?? 'none'}`} />
  ),
}));

vi.mock('../use-toggle-share-with-team', () => ({
  useActiveCallTeamShare: () => ({
    toggle: () => Promise.resolve(),
    canToggle: () => true,
    isPending: () => false,
  }),
}));

type MockTrackPublication = {
  isMuted: boolean;
  isSubscribed: boolean;
  track?: Track;
};

type ParticipantPublications = Record<string, MockTrackPublication | undefined>;

type CallStateControls = {
  setChannelId: Setter<string | null>;
  setAudioMuted: Setter<boolean>;
  setParticipants: Setter<Map<string, RemoteParticipant>>;
  setTrackVersion: Setter<number>;
};

function createTrack(sid: string): Track {
  return { sid } as unknown as Track;
}

function createRemoteParticipant(
  identity: string,
  publications: ParticipantPublications,
  name?: string
): RemoteParticipant {
  return {
    identity,
    name,
    isAgent: false,
    getTrackPublication(source: string) {
      return publications[source];
    },
  } as unknown as RemoteParticipant;
}

function setUpCallState(
  initialParticipants: RemoteParticipant[] = []
): CallStateControls {
  const [audioMuted, setAudioMuted] = createSignal(false);
  const [channelId, setChannelId] = createSignal<string | null>('channel-1');
  const [participants, setParticipants] = createSignal(
    new Map(
      initialParticipants.map((participant) => [
        participant.identity,
        participant,
      ])
    )
  );
  const [trackVersion, setTrackVersion] = createSignal(0);
  const localCameraTrack = createTrack('local-camera');

  mocks.callContext = {
    activeChannelId: channelId,
    activeCallId: () => 'call-id',
    connectionState: () => 'connected',
    isAudioMuted: audioMuted,
    isConnecting: () => false,
    isLocalSpeaking: () => false,
    isParticipantSpeaking: () => false,
    isScreenSharing: () => false,
    isSharedWithTeam: () => false,
    isVideoMuted: () => false,
    remoteParticipants: participants,
    room: () => ({
      localParticipant: {
        identity: 'current-user',
        getTrackPublication: () => ({ track: localCameraTrack }),
      },
    }),
    trackVersion,
  } as unknown as CallState;

  return { setChannelId, setAudioMuted, setParticipants, setTrackVersion };
}

beforeEach(() => {
  mocks.displayNames.clear();
});

describe('CallOverlay muted microphone badges', () => {
  it('excludes standalone calls from team sharing even when the caller enables the control', () => {
    const controls = setUpCallState();
    controls.setChannelId(null);
    render(() => <CallOverlay onLeave={() => undefined} showTeamSharing />);
    fireEvent.click(screen.getByRole('button', { name: 'Show people' }));
    expect(screen.queryByRole('switch')).toBeNull();
    controls.setChannelId('channel-1');
    expect(
      screen.getByRole('switch', { name: 'Share with team' })
    ).toBeTruthy();
    controls.setChannelId(null);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('uses the guest name from the media session and hides team sharing for guests', () => {
    const guest = createRemoteParticipant(
      'guest|opaque-id',
      {},
      'Taylor Guest'
    );
    setUpCallState([guest]);
    render(() => (
      <CallOverlay onLeave={() => undefined} showTeamSharing={false} />
    ));
    expect(screen.getAllByText('Taylor Guest').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('status', { name: 'Taylor Guest is muted' })
    ).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('opens chat for a standalone meeting without a channel', async () => {
    const controls = setUpCallState();
    controls.setChannelId(null);
    render(() => (
      <CallOverlay onLeave={() => undefined} showTeamSharing={false} />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect(
      await screen.findByRole('textbox', { name: 'Message this call' })
    ).toBeTruthy();
    expect(screen.getByText('call-id')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('does not mount authenticated message queries for a guest', () => {
    const controls = setUpCallState();
    controls.setChannelId(null);
    render(() => <CallOverlay onLeave={() => undefined} showChat={false} />);
    expect(screen.queryByRole('button', { name: 'Open chat' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Call chat' })).toBeNull();
  });

  it('opens the call thread without remounting video and restores focus when closed', async () => {
    setUpCallState();
    render(() => <CallOverlay onLeave={() => undefined} />);
    const video = screen.getByTestId('track-local-camera');
    const toggle = screen.getByRole('button', { name: 'Open chat' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    const composer = await screen.findByRole('textbox', {
      name: 'Message this call',
    });
    fireEvent.input(composer, { target: { value: 'Draft' } });
    expect(screen.getByText('call-id')).toBeTruthy();
    expect(screen.getByTestId('track-local-camera')).toBe(video);
    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('textbox', { name: 'Message this call' })).toBe(
      composer
    );
    expect((composer as HTMLInputElement).value).toBe('Draft');
    expect(screen.getByTestId('track-local-camera')).toBe(video);
  });

  it('opens the sidebar on People or Chat and switches between its tabs', async () => {
    setUpCallState([createRemoteParticipant('alex', {}, 'Alex Morgan')]);
    render(() => <CallOverlay onLeave={() => undefined} />);
    const sidebar = () =>
      screen.queryByRole('complementary', { name: 'Call sidebar' });
    // Hidden tabs stay mounted, so check what is showing.
    const showingPeople = () =>
      screen
        .queryAllByText('Alex Morgan', {
          selector: '[aria-label="Call sidebar"] *',
        })
        .some((node) => !node.closest('[hidden]'));
    expect(sidebar()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show people' }));
    expect(sidebar()?.textContent).toContain('Current User');
    expect(showingPeople()).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Chat' }));
    await screen.findByRole('textbox', { name: 'Message this call' });
    expect(
      screen
        .getByRole('button', { name: 'Close chat' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(showingPeople()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(sidebar()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show people' }));
    expect(showingPeople()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hide people' }));
    expect(sidebar()).toBeNull();
  });

  it('shows local mute state on both the full tile and local PIP', () => {
    const controls = setUpCallState();

    render(() => <CallOverlay onLeave={() => undefined} />);

    expect(screen.queryByRole('status', { name: 'You are muted' })).toBeNull();

    controls.setAudioMuted(true);
    const fullTileBadge = screen.getByRole('status', {
      name: 'You are muted',
    });

    expect(
      fullTileBadge.parentElement?.querySelector(
        '[data-testid="track-local-camera"]'
      )
    ).not.toBeNull();
    expect(fullTileBadge.closest('.bottom-4')).toBeNull();

    const remote = createRemoteParticipant('alex', {});
    controls.setParticipants(new Map([[remote.identity, remote]]));

    const pipBadge = screen.getByRole('status', { name: 'You are muted' });
    expect(pipBadge.closest('.bottom-4')).not.toBeNull();

    controls.setAudioMuted(false);
    expect(screen.queryByRole('status', { name: 'You are muted' })).toBeNull();
  });

  it('reacts to remote microphone mute events over video content', () => {
    mocks.displayNames.set('alex', 'Alex Morgan');
    const microphone: MockTrackPublication = {
      isMuted: true,
      isSubscribed: true,
    };
    const publications: ParticipantPublications = {
      camera: {
        isMuted: false,
        isSubscribed: true,
        track: createTrack('alex-camera'),
      },
      microphone,
    };
    const remote = createRemoteParticipant('alex', publications);
    const controls = setUpCallState([remote]);

    render(() => <CallOverlay onLeave={() => undefined} />);

    const badge = screen.getByRole('status', {
      name: 'Alex Morgan is muted',
    });
    expect(
      badge.parentElement?.querySelector('[data-testid="track-alex-camera"]')
    ).not.toBeNull();

    microphone.isMuted = false;
    controls.setTrackVersion((version) => version + 1);
    expect(
      screen.queryByRole('status', { name: 'Alex Morgan is muted' })
    ).toBeNull();

    microphone.isMuted = true;
    controls.setTrackVersion((version) => version + 1);
    expect(
      screen.getByRole('status', { name: 'Alex Morgan is muted' })
    ).toBeTruthy();
  });

  it('treats a missing remote microphone as muted over avatar content', () => {
    mocks.displayNames.set('alex', 'Alex Morgan');
    const publications: ParticipantPublications = {};
    const remote = createRemoteParticipant('alex', publications);
    const controls = setUpCallState([remote]);

    render(() => <CallOverlay onLeave={() => undefined} />);

    const badge = screen.getByRole('status', {
      name: 'Alex Morgan is muted',
    });
    const tile = badge.parentElement;

    expect(tile?.classList).toContain('relative');
    expect(tile?.querySelector('[data-testid="user-avatar"]')).not.toBeNull();
    expect(tile?.textContent).toContain('A');
    expect(tile?.querySelector('[data-testid="track-alex-camera"]')).toBeNull();

    publications.microphone = {
      isMuted: false,
      isSubscribed: true,
    };
    controls.setTrackVersion((version) => version + 1);
    expect(
      screen.queryByRole('status', { name: 'Alex Morgan is muted' })
    ).toBeNull();
  });
});
