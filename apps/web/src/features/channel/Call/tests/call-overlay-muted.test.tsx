/**
 * @vitest-environment jsdom
 */

import type { WorkItem } from '@app/features/agent-work/core/work-item';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import type { RemoteParticipant, Track } from 'livekit-client';
import { createSignal, type JSX, type Setter } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallState } from '../CallContext';
import { CallOverlay } from '../CallOverlay';
import { CallParticipantsList } from '../CallParticipantsList';

const mocks = vi.hoisted(() => ({
  callContext: undefined as unknown,
  displayNames: new Map<string, string>(),
  mobile: false,
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));

const registeredWork = vi.hoisted(() => ({
  accounts: undefined as undefined | (() => readonly string[]),
  items: undefined as
    | undefined
    | (() => ReadonlyMap<string, readonly WorkItem[]>),
  loaded: undefined as undefined | (() => boolean),
}));

vi.mock('@core/component/UserGroup', () => ({ UserGroup: () => null }));

vi.mock('@app/features/agent-work/views/use-work-client', () => ({
  useWorkClient: () => () => undefined,
}));

vi.mock('@app/features/agent-work/primitives/create-registered-work', () => ({
  createRegisteredWork: () => ({
    loaded: () => registeredWork.loaded?.() ?? false,
    byAccount: () => registeredWork.items?.() ?? new Map(),
    accountsWithWork: () => registeredWork.accounts?.() ?? [],
  }),
}));

vi.mock('@core/mobile/isMobile', () => ({
  isMobile: () => mocks.mobile,
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
  isAgentAccount: () => true,
  tryMacroId: (identity: string) => identity,
  getDisplayName: (identity: string) =>
    mocks.displayNames.get(identity) ?? identity,
}));

vi.mock('@ui', async () => ({
  Avatar: (await import('@ui/components/Avatar')).Avatar,
  Button: (await import('@ui/components/Button')).Button,
  Hotkey: (await import('@ui/components/Hotkey')).Hotkey,
  Layer: (await import('@ui/components/Layer')).Layer,
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(' '),
  Tabs: (await import('@ui/components/Tabs')).Tabs,
  Dropdown: (await import('@ui/components/Dropdown')).Dropdown,
  ToggleSwitch: (await import('@ui/components/ToggleSwitch')).ToggleSwitch,
  SingleSelectCheck: (await import('@ui/components/Checkbox'))
    .SingleSelectCheck,
  Tooltip: (props: { children: unknown }) => props.children,
}));

vi.mock('../CallContext', () => ({
  useCallContext: () => mocks.callContext,
  useCallContextOptional: () => mocks.callContext,
}));

vi.mock('../CallControls/CallControls', () => ({
  CallControls: (props: { children?: JSX.Element }) => props.children,
}));

vi.mock('../chat/CallChat', () => ({
  default: (props: { callId: string; open: boolean; onClose: () => void }) => (
    <aside hidden={!props.open} aria-label="Call chat">
      <p>{props.callId}</p>
      <input aria-label="Message this call" />
      <button onClick={props.onClose}>Close sidebar</button>
    </aside>
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
  setScreenSharing: Setter<boolean>;
  setParticipants: Setter<Map<string, RemoteParticipant>>;
  setTrackVersion: Setter<number>;
};

function createTrack(sid: string): Track {
  return { sid } as unknown as Track;
}

function createRemoteParticipant(
  identity: string,
  publications: ParticipantPublications,
  name?: string,
  isAgent = false
): RemoteParticipant {
  return {
    identity,
    name,
    isAgent,
    getTrackPublication(source: string) {
      return publications[source];
    },
  } as unknown as RemoteParticipant;
}

function setUpCallState(
  initialParticipants: RemoteParticipant[] = []
): CallStateControls {
  const [audioMuted, setAudioMuted] = createSignal(false);
  const [screenSharing, setScreenSharing] = createSignal(false);
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
    isInCall: () => true,
    toggleAudio: vi.fn(),
    toggleVideo: vi.fn(),
    isConnecting: () => false,
    isLocalSpeaking: () => false,
    isParticipantSpeaking: () => false,
    isScreenSharing: screenSharing,
    toggleScreenShare: vi.fn(),
    isSharedWithTeam: () => false,
    isVideoMuted: () => false,
    remoteParticipants: participants,
    room: () => ({
      on: () => {},
      off: () => {},
      localParticipant: {
        identity: 'current-user',
        getTrackPublication: () => ({ track: localCameraTrack }),
      },
    }),
    trackVersion,
  } as unknown as CallState;

  return {
    setChannelId,
    setAudioMuted,
    setScreenSharing,
    setParticipants,
    setTrackVersion,
  };
}

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  mocks.mobile = false;
  localStorage.removeItem('call.layout');
  mocks.displayNames.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

describe('CallOverlay screen share', () => {
  it('hides participants without remounting tracks and resets when sharing ends', async () => {
    const screenShare: MockTrackPublication = {
      isMuted: false,
      isSubscribed: true,
      track: createTrack('remote-screen'),
    };
    const sharer = createRemoteParticipant(
      'sharer',
      {
        camera: {
          isMuted: false,
          isSubscribed: true,
          track: createTrack('remote-camera'),
        },
        screen_share: screenShare,
      },
      'Sam Sharer'
    );
    const controls = setUpCallState([sharer]);
    render(() => <CallOverlay onLeave={() => undefined} />);
    const camera = screen.getByTestId('track-remote-camera');
    const more = screen.getByRole('button', { name: 'More' });
    more.focus();
    fireEvent.keyDown(more, { key: 'ArrowDown' });
    const toggle = await screen.findByRole('menuitemcheckbox', {
      name: /Hide participants/,
    });
    toggle.focus();
    fireEvent.keyDown(toggle, { key: 'Enter' });
    await waitFor(() =>
      expect(toggle.getAttribute('aria-checked')).toBe('true')
    );
    expect(camera.closest('[hidden]')).not.toBeNull();
    expect(screen.getByTestId('track-remote-camera')).toBe(camera);
    expect(screen.getByTestId('track-remote-screen')).toBeTruthy();

    fireEvent.keyDown(toggle, { key: 'Enter' });
    await waitFor(() =>
      expect(toggle.getAttribute('aria-checked')).toBe('false')
    );
    expect(camera.closest('[hidden]')).toBeNull();
    fireEvent.keyDown(toggle, { key: 'Enter' });
    await waitFor(() =>
      expect(toggle.getAttribute('aria-checked')).toBe('true')
    );
    screenShare.track = undefined;
    controls.setTrackVersion((version) => version + 1);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(camera.closest('[hidden]')).toBeNull();
  });
});

describe('CallOverlay muted microphone badges', () => {
  it('excludes standalone calls from team sharing even when the caller enables the control', () => {
    const controls = setUpCallState();
    controls.setChannelId(null);
    render(() => <CallOverlay onLeave={() => undefined} showTeamSharing />);
    expect(screen.queryByRole('button', { name: /^Call sharing:/ })).toBeNull();
    controls.setChannelId('channel-1');
    expect(
      screen.getByRole('button', { name: 'Call sharing: Private' })
    ).toBeTruthy();
    controls.setChannelId(null);
    expect(screen.queryByRole('button', { name: /^Call sharing:/ })).toBeNull();
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
    expect(screen.getByText('Taylor Guest')).toBeTruthy();
    expect(
      screen.getByRole('status', { name: 'Taylor Guest is muted' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Call sharing:/ })).toBeNull();
  });

  it('restores the phone sidebar trigger after Escape', async () => {
    vi.useFakeTimers();
    mocks.mobile = true;
    setUpCallState();
    const view = render(() => (
      <>
        <button>Previous focus</button>
        <CallOverlay onLeave={() => undefined} />
      </>
    ));
    try {
      screen.getByRole('button', { name: 'Previous focus' }).focus();
      const trigger = screen.getByRole('button', {
        name: 'Open chat and participants',
      });
      fireEvent.click(trigger);
      await vi.advanceTimersByTimeAsync(500);
      fireEvent.keyDown(screen.getByRole('radio', { name: 'Chat' }), {
        key: 'Escape',
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('opens chat for a standalone meeting without a channel', async () => {
    const controls = setUpCallState();
    controls.setChannelId(null);
    render(() => (
      <CallOverlay onLeave={() => undefined} showTeamSharing={false} />
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Open chat and participants' })
    );
    expect(
      await screen.findByRole('textbox', { name: 'Message this call' })
    ).toBeTruthy();
    expect(screen.getByText('call-id')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Call sharing:/ })).toBeNull();
  });

  it('keeps the roster available without mounting unavailable message queries', () => {
    const controls = setUpCallState();
    controls.setChannelId(null);
    render(() => <CallOverlay onLeave={() => undefined} showChat={false} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Open chat and participants' })
    );
    expect(
      screen.getByRole('list', { name: 'In-call participants' })
    ).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: 'Chat' }).hasAttribute('disabled')
    ).toBe(true);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('call-id')).toBeNull();
  });

  it('opens the call thread without remounting video and restores focus when closed', async () => {
    setUpCallState();
    render(() => <CallOverlay onLeave={() => undefined} />);
    const video = screen.getByTestId('track-local-camera');
    const toggle = screen.getByRole('button', {
      name: 'Open chat and participants',
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const composer = await screen.findByRole('textbox', {
      name: 'Message this call',
    });
    fireEvent.input(composer, { target: { value: 'Draft' } });
    expect(screen.getByText('call-id')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /People/ }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(composer.isConnected).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Chat' }));
    expect(screen.getByRole('textbox', { name: 'Message this call' })).toBe(
      composer
    );
    expect((composer as HTMLInputElement).value).toBe('Draft');
    expect(screen.getByTestId('track-local-camera')).toBe(video);
    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('textbox', { name: 'Message this call' })).toBe(
      composer
    );
    expect((composer as HTMLInputElement).value).toBe('Draft');
    expect(screen.getByTestId('track-local-camera')).toBe(video);
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
      fullTileBadge
        .closest('[data-call-tile]')
        ?.querySelector('[data-testid="track-local-camera"]')
    ).not.toBeNull();
    expect(fullTileBadge.closest('.bottom-4')).toBeNull();

    const remote = createRemoteParticipant('alex', {});
    controls.setParticipants(new Map([[remote.identity, remote]]));

    const pipBadge = screen.getByRole('status', { name: 'You are muted' });
    expect(
      pipBadge
        .closest('[data-call-tile]')
        ?.querySelector('[data-testid="track-local-camera"]')
    ).not.toBeNull();

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
      badge
        .closest('[data-call-tile]')
        ?.querySelector('[data-testid="track-alex-camera"]')
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

  it('offers the existing stop action instead of replaying the local shared display', () => {
    const controls = setUpCallState();
    controls.setScreenSharing(true);
    render(() => <CallOverlay onLeave={() => undefined} />);
    expect(screen.getByText("You're sharing your screen")).toBeTruthy();
    expect(screen.queryByText('Your screen')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(
      (mocks.callContext as CallState).toggleScreenShare
    ).toHaveBeenCalledOnce();
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
    const tile = badge.closest('[data-call-tile]');

    expect(tile?.classList).toContain('relative');
    expect(tile?.querySelector('[data-testid="user-avatar"]')).toBeNull();
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

  it('disables solo focus and clears it when the last remote participant leaves', () => {
    const controls = setUpCallState();
    render(() => <CallOverlay onLeave={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Focus yourself' })).toBeNull();
    const remote = createRemoteParticipant('remote', {}, 'Remote participant');
    controls.setParticipants(new Map([[remote.identity, remote]]));
    fireEvent.click(screen.getByRole('button', { name: 'Focus yourself' }));
    expect(screen.getByRole('button', { name: 'Back to grid' })).toBeTruthy();
    controls.setParticipants(new Map());
    expect(screen.queryByRole('button', { name: 'Focus yourself' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to grid' })).toBeNull();
    controls.setParticipants(new Map([[remote.identity, remote]]));
    expect(screen.queryByRole('button', { name: 'Back to grid' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Focus Remote participant' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to grid' }));
    expect(
      screen.getByRole('button', { name: 'Focus Remote participant' })
    ).toBeTruthy();
  });
  it('focuses a participant without remounting video and restores the grid when they leave', () => {
    const first = createRemoteParticipant(
      'first',
      {
        camera: {
          isMuted: false,
          isSubscribed: true,
          track: createTrack('first-camera'),
        },
      },
      'First participant'
    );
    const second = createRemoteParticipant('second', {}, 'Second participant');
    const controls = setUpCallState([first, second]);
    render(() => <CallOverlay onLeave={() => undefined} />);
    const video = screen.getByTestId('track-first-camera');
    fireEvent.click(
      screen.getByRole('button', { name: 'Focus First participant' })
    );
    expect(
      screen
        .getByRole('button', { name: 'Unfocus First participant' })
        .getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      screen.queryByRole('button', { name: 'Focus Second participant' })
    ).toBeNull();
    expect(screen.getByTestId('track-first-camera')).toBe(video);
    fireEvent.click(
      screen.getByRole('button', { name: 'Unfocus First participant' })
    );
    expect(
      screen.getByRole('button', { name: 'Focus Second participant' })
    ).toBeTruthy();
    expect(screen.getByTestId('track-first-camera')).toBe(video);
    fireEvent.click(screen.getByRole('button', { name: 'Focus yourself' }));
    expect(
      screen.getByRole('button', { name: 'Focus First participant' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Focus Second participant' })
    ).toBeTruthy();
    expect(screen.getByTestId('track-first-camera')).toBe(video);
    fireEvent.click(
      screen.getByRole('button', { name: 'Focus First participant' })
    );
    controls.setParticipants(new Map([[second.identity, second]]));
    expect(
      screen.getByRole('button', { name: 'Focus Second participant' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Unfocus First participant' })
    ).toBeNull();
  });

  it.each([false, true])(
    'swaps the local and remote views without remounting video (phone: %s)',
    (mobile) => {
      mocks.mobile = mobile;
      const remote = createRemoteParticipant(
        'remote',
        {
          camera: {
            isMuted: false,
            isSubscribed: true,
            track: createTrack('remote-camera'),
          },
        },
        'Remote participant'
      );
      setUpCallState([remote]);
      render(() => <CallOverlay onLeave={() => undefined} />);
      const localVideo = screen.getByTestId('track-local-camera');
      const remoteVideo = screen.getByTestId('track-remote-camera');
      fireEvent.click(screen.getByRole('button', { name: 'Focus yourself' }));
      expect(
        screen.getByRole('button', { name: 'Focus Remote participant' })
      ).toBeTruthy();
      expect(screen.getByTestId('track-local-camera')).toBe(localVideo);
      expect(screen.getByTestId('track-remote-camera')).toBe(remoteVideo);
      fireEvent.click(
        screen.getByRole('button', { name: 'Focus Remote participant' })
      );
      expect(
        screen.getByRole('button', { name: 'Focus yourself' })
      ).toBeTruthy();
      expect(screen.getByTestId('track-local-camera')).toBe(localVideo);
      expect(screen.getByTestId('track-remote-camera')).toBe(remoteVideo);
      fireEvent.click(
        screen.getByRole('button', { name: 'Unfocus Remote participant' })
      );
      expect(
        screen.getByRole('button', { name: 'Focus Remote participant' })
      ).toBeTruthy();
      expect(screen.getByTestId('track-local-camera')).toBe(localVideo);
      expect(screen.getByTestId('track-remote-camera')).toBe(remoteVideo);
    }
  );
});

describe('CallOverlay Work', () => {
  const account = 'macro|agent@example.com';
  const row: WorkItem = {
    registrationId: 'registration-1',
    accountId: account,
    registeredAt: '2026-11-05T10:00:00Z',
    sessionId: 'session-1',
    title: 'Tavily web search',
    state: 'needs_input',
  };

  function setUpWork() {
    const [accounts, setAccounts] = createSignal<readonly string[]>([]);
    registeredWork.accounts = accounts;
    registeredWork.items = () => new Map(accounts().map((id) => [id, [row]]));
    registeredWork.loaded = () => true;
    setUpCallState([createRemoteParticipant(account, {}, 'Agent teammate')]);
    return setAccounts;
  }

  afterEach(() => {
    registeredWork.accounts = undefined;
    registeredWork.items = undefined;
    registeredWork.loaded = undefined;
  });

  it('prompts when work appears and opens it in the Work tab', async () => {
    const setAccounts = setUpWork();
    render(() => <CallOverlay onLeave={() => undefined} />);
    expect(screen.queryByText('View active work')).toBeNull();

    setAccounts([account]);
    fireEvent.click(await screen.findByText('View active work'));

    expect(await screen.findByText('Tavily web search')).toBeTruthy();
    expect(screen.getByText('Needs input')).toBeTruthy();
    expect(screen.queryByText('View active work')).toBeNull();
  });

  it('dismisses the prompt without opening the panel', async () => {
    const setAccounts = setUpWork();
    render(() => <CallOverlay onLeave={() => undefined} />);

    setAccounts([account]);
    await screen.findByText('View active work');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('View active work')).toBeNull();
    expect(screen.queryByText('Tavily web search')).toBeNull();
  });

  it('returns to Chat when the last work ends', async () => {
    const setAccounts = setUpWork();
    render(() => <CallOverlay onLeave={() => undefined} />);

    setAccounts([account]);
    fireEvent.click(await screen.findByText('View active work'));
    await screen.findByText('Tavily web search');

    setAccounts([]);
    await waitFor(() =>
      expect(screen.queryByRole('radio', { name: 'Work' })).toBeNull()
    );
    expect(screen.queryByText('Tavily web search')).toBeNull();
  });
});

describe('CallParticipantsList live roster', () => {
  it('tracks human arrivals and departures without counting recording agents', () => {
    const guest = createRemoteParticipant('guest-1', {}, 'Guest attendee');
    const agent = createRemoteParticipant('agent-1', {}, 'Recorder', true);
    const controls = setUpCallState([guest, agent]);
    render(() => <CallParticipantsList localName="Local attendee" />);
    const list = screen.getByRole('list', { name: 'In-call participants' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list.textContent).toContain('Local attendee');
    expect(list.textContent).toContain('Guest attendee');
    expect(list.textContent).not.toContain('Recorder');

    const joined = createRemoteParticipant('guest-2', {}, 'New attendee');
    controls.setParticipants(
      new Map([
        [guest.identity, guest],
        [agent.identity, agent],
        [joined.identity, joined],
      ])
    );
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(list.textContent).toContain('New attendee');

    controls.setParticipants(new Map([[agent.identity, agent]]));
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list.textContent).not.toContain('Guest attendee');
    expect(list.textContent).not.toContain('New attendee');
  });

  it('updates microphone and camera status when live publications change', () => {
    const publications: ParticipantPublications = {};
    const guest = createRemoteParticipant(
      'guest-1',
      publications,
      'Guest attendee'
    );
    const controls = setUpCallState([guest]);
    render(() => <CallParticipantsList />);
    const row = screen.getByText('Guest attendee').closest('li')!;
    expect(
      within(row).getByRole('img', { name: 'Microphone off' })
    ).toBeTruthy();
    expect(within(row).getByRole('img', { name: 'Camera off' })).toBeTruthy();

    publications.microphone = { isMuted: false, isSubscribed: true };
    publications.camera = { isMuted: false, isSubscribed: false };
    controls.setTrackVersion((version) => version + 1);
    expect(
      within(row).getByRole('img', { name: 'Microphone on' })
    ).toBeTruthy();
    expect(within(row).getByRole('img', { name: 'Camera on' })).toBeTruthy();

    publications.microphone.isMuted = true;
    publications.camera.isMuted = true;
    controls.setTrackVersion((version) => version + 1);
    expect(
      within(row).getByRole('img', { name: 'Microphone off' })
    ).toBeTruthy();
    expect(within(row).getByRole('img', { name: 'Camera off' })).toBeTruthy();
  });
});

it.each(['auto', 'speaker', 'sidebar', 'grid'] as const)(
  'shares edge visibility state with More in %s layout',
  async (layout) => {
    const participant = createRemoteParticipant(
      'presenter',
      {
        screen_share: {
          isMuted: false,
          isSubscribed: true,
          track: createTrack('screen'),
        },
      },
      'Presenter'
    );
    setUpCallState([participant]);
    localStorage.setItem('call.layout', JSON.stringify(layout));
    render(() => <CallOverlay onLeave={() => {}} />);
    const edge = screen.queryByRole('button', { name: 'Hide participants' });
    if (layout === 'grid') {
      expect(edge).toBeNull();
      return;
    }
    expect(
      edge?.querySelector(
        `[data-macro-icon="${layout === 'sidebar' ? 'caret-right' : 'caret-down'}"]`
      )
    ).toBeTruthy();
    fireEvent.click(edge!);
    const restore = screen.getByRole('button', { name: 'Show participants' });
    expect(
      restore.querySelector(
        `[data-macro-icon="${layout === 'sidebar' ? 'caret-left' : 'caret-up'}"]`
      )
    ).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), {
      key: 'ArrowDown',
    });
    const item = await screen.findByRole('menuitemcheckbox', {
      name: /Hide participants/,
    });
    expect(item.getAttribute('aria-checked')).toBe('true');
    item.focus();
    fireEvent.keyDown(item, { key: 'Enter' });
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(
      await screen.findByRole('button', { name: 'Hide participants' })
    ).toBeTruthy();
  }
);

it('leads shared-screen and speaking chips with their action icon before the avatar', () => {
  const participant = createRemoteParticipant(
    'presenter',
    {
      screen_share: {
        isMuted: false,
        isSubscribed: true,
        track: createTrack('screen'),
      },
    },
    'Presenter'
  );
  setUpCallState([participant]);
  mocks.callContext.isParticipantSpeaking = () => true;
  const { container } = render(() => <CallOverlay onLeave={() => {}} />);
  const share = container.querySelector('[data-call-stage-chip="share"]');
  expect(share?.firstElementChild?.getAttribute('data-macro-icon')).toBe(
    'screencast'
  );
  expect(
    share?.children[1].querySelector('[data-testid="user-avatar"]')
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Hide participants' }));
  const speaker = container.querySelector('[data-call-stage-chip="speaker"]');
  expect(speaker?.firstElementChild?.getAttribute('data-macro-icon')).toBe(
    'waveform'
  );
  expect(
    speaker?.children[1].querySelector('[data-testid="user-avatar"]')
  ).toBeTruthy();
  expect(speaker?.textContent).toContain('Presenter');
});
