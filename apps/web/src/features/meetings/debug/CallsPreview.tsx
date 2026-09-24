import { CallStateProvider } from '@channel/Call/CallContext';
import { CallOverlay } from '@channel/Call/CallOverlay';
import { writeClipboardData } from '@core/util/dataTransfer';
import { useNavigate } from '@solidjs/router';
import { type Accessor, createSignal, Show } from 'solid-js';
import { MeetingCallHeading } from '../components/meeting-call-heading';
import { MeetingCopyButton } from '../components/meeting-copy-button';
import type { MeetingRouteTarget } from '../core/meeting-navigation';
import { createMeetingNavigation } from '../primitives/meeting-navigation';
import { createMeetingSessionLifecycle } from '../primitives/meeting-session-lifecycle';
import { MeetingInvite } from '../views/meeting-invite';
import { MeetingPage } from '../views/meeting-page';
import { createPreviewCallState } from './preview-call-state';

const previewUrl = 'https://macro.com/app/meet/preview-only';
const people = [
  {
    name: 'Eric Hayes',
    photoUrl: '/sam.png',
  },
  {
    name: 'Marcus Oduya',
    photoUrl: '/ness.png',
  },
  {
    name: 'Priya Natarajan',
    photoUrl: '/teo.png',
  },
];
export function JoinCallPreview(props: { startInCall?: boolean }) {
  const navigate = useNavigate();
  const lifecycle = createMeetingSessionLifecycle();
  const [target, setTarget] = createSignal<MeetingRouteTarget>({
    kind: props.startInCall ? 'active' : 'setup',
    shareToken: 'preview-only',
  });
  const navigation = createMeetingNavigation({
    target,
    replace: setTarget,
    returnToApp: () => navigate('/', { replace: true }),
  });
  const leave = () => navigation.leave(navigation.entry());
  const [member, setMember] = createSignal(Boolean(props.startInCall));
  const [selectedTeammates, setSelectedTeammates] = createSignal(
    new Set<string>()
  );
  const teammates = [
    {
      id: 'macro|maya@example.com',
      name: 'Maya Chen',
      email: 'maya@example.com',
    },
    {
      id: 'macro|ada@example.com',
      name: 'Ada Rivera',
      email: 'ada@example.com',
    },
    {
      id: 'macro|dana@example.com',
      name: 'Dana Davis',
      email: 'dana@example.com',
    },
    {
      id: 'macro|evan@example.com',
      name: 'Evan Ellis',
      email: 'evan@example.com',
    },
  ];
  const [title, setTitle] = createSignal('Northwind kickoff');
  const [connected, setConnected] = createSignal(false);
  const controller = createPreviewCallState();
  const [showInCallPreview, setShowInCallPreview] = createSignal(
    Boolean(props.startInCall)
  );
  const copy = async () => {
    if (!(await writeClipboardData({ 'text/plain': previewUrl })))
      throw new Error('Clipboard unavailable');
  };
  const renderCall = (onLeave: () => void, name: Accessor<string>) => (
    <CallOverlay
      onLeave={onLeave}
      localName={name()}
      renderAvatar={(_id, participantName) => (
        <img
          src={
            people.find((person) => person.name === participantName)
              ?.photoUrl ??
            (participantName === 'Dana Whitfield' ? '/ness.png' : '/sam.png')
          }
          alt={
            participantName
              ? `${participantName}'s profile picture`
              : 'Your profile picture'
          }
          class="size-full rounded-full object-cover"
        />
      )}
      showTeamSharing={false}
    />
  );
  return (
    <CallStateProvider value={controller}>
      <div class="h-full overflow-auto bg-surface text-ink">
        <div class="flex items-center gap-3 border-b border-edge-muted p-3 text-xs text-ink-muted">
          <span>Call preview · simulated media and participants</span>
          <label class="ml-auto flex gap-2">
            <input
              type="checkbox"
              checked={member()}
              onChange={(event) => setMember(event.currentTarget.checked)}
            />
            Signed in
          </label>
        </div>
        <Show
          when={showInCallPreview()}
          fallback={
            <MeetingPage
              onLeave={leave}
              onCallStateChange={(connected) =>
                navigation.setCallState(
                  navigation.entry(),
                  connected,
                  'preview-only'
                )
              }
              source={() => ({
                kind: 'ready',
                title: title(),
                scheduledStart: null,
                scheduledEnd: null,
                channelId: null,
              })}
              authenticated={member}
              startCall={member() && !props.startInCall}
              renderInvite={(joining) => (
                <MeetingInvite
                  source={{
                    people: () => teammates,
                    loading: () => false,
                    error: () => undefined,
                    refresh: () => {},
                  }}
                  selected={selectedTeammates}
                  setSelected={setSelectedTeammates}
                  disabled={joining()}
                />
              )}
              author={() => 'Eric Hayes'}
              avatar={
                <img
                  src="/sam.png"
                  alt="Your profile picture"
                  class="size-full rounded-full object-cover"
                />
              }
              onRename={
                member()
                  ? async (name) => {
                      setTitle(name);
                    }
                  : undefined
              }
              url={previewUrl}
              onCopy={copy}
              session={{
                lifecycle,
                shareToken: () => 'preview-only',
                isInCall: connected,
                activeCallId: () => (connected() ? 'preview-call' : null),
                join: async () => ({
                  callId: 'preview-call',
                  channelId: null,
                  roomName: 'preview',
                  serverUrl: '',
                  token: '',
                  participantId: 'guest:preview',
                  shareToken: 'preview-only',
                }),
                release: async () => {},
                connect: async (_credentials, preferences) => {
                  if (
                    controller.isAudioMuted() === preferences.microphoneEnabled
                  )
                    await controller.toggleAudio();
                  setConnected(true);
                },
                disconnect: async () => {
                  setConnected(false);
                },
              }}
              renderCall={renderCall}
            />
          }
        >
          <main class="ph-no-capture flex h-dvh min-h-0 flex-col bg-surface p-4 text-ink sm:p-6">
            <header class="flex flex-wrap items-center gap-4 pb-4">
              <MeetingCallHeading
                title={title()}
                onRename={
                  member()
                    ? async (name) => {
                        setTitle(name);
                      }
                    : undefined
                }
              />
              <MeetingCopyButton url={previewUrl} onCopy={copy} />
            </header>
            <div class="min-h-0 flex-1">
              {renderCall(
                () => {
                  leave();
                  setShowInCallPreview(false);
                },
                () => 'Eric Hayes'
              )}
            </div>
          </main>
        </Show>
      </div>
    </CallStateProvider>
  );
}

export function InCallPreview() {
  return <JoinCallPreview startInCall />;
}
