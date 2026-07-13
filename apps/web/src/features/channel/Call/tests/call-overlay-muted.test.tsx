/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
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
  useDisplayName: (identity: string) => [
    () => mocks.displayNames.get(identity) ?? identity,
  ],
}));

vi.mock('@ui', () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(' '),
  InlineCheckbox: () => null,
  Tooltip: (props: { children: unknown }) => props.children,
}));

vi.mock('../CallContext', () => ({
  useCallContext: () => mocks.callContext,
}));

vi.mock('../CallControls/CallControls', () => ({
  CallControls: () => null,
}));

vi.mock('../TrackView', () => ({
  TrackView: (props: { track?: { sid?: string } }) => (
    <div data-testid={`track-${props.track?.sid ?? 'none'}`} />
  ),
}));

vi.mock('../use-toggle-share-with-team', () => ({
  useToggleShareWithTeam: () => () => undefined,
}));

type MockTrackPublication = {
  isMuted: boolean;
  isSubscribed: boolean;
  track?: Track;
};

type ParticipantPublications = Record<string, MockTrackPublication | undefined>;

type CallStateControls = {
  setAudioMuted: Setter<boolean>;
  setParticipants: Setter<Map<string, RemoteParticipant>>;
  setTrackVersion: Setter<number>;
};

function createTrack(sid: string): Track {
  return { sid } as unknown as Track;
}

function createRemoteParticipant(
  identity: string,
  publications: ParticipantPublications
): RemoteParticipant {
  return {
    identity,
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

  return { setAudioMuted, setParticipants, setTrackVersion };
}

beforeEach(() => {
  mocks.displayNames.clear();
});

describe('CallOverlay muted microphone badges', () => {
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
    expect(fullTileBadge.parentElement?.parentElement?.className).not.toContain(
      'bottom-4'
    );

    const remote = createRemoteParticipant('alex', {});
    controls.setParticipants(new Map([[remote.identity, remote]]));

    const pipBadge = screen.getByRole('status', { name: 'You are muted' });
    expect(pipBadge.parentElement?.parentElement?.className).toContain(
      'bottom-4'
    );

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
