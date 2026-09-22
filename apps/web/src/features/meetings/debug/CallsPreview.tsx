import { CallStateProvider } from '@channel/Call/CallContext';
import { CallOverlay } from '@channel/Call/CallOverlay';
import { writeClipboardData } from '@core/util/dataTransfer';
import { Button } from '@ui';
import { type Accessor, createSignal, Show } from 'solid-js';
import { CalendarActiveCallNotice } from '../components/calendar-active-call-notice';
import { MeetingCallHeading } from '../components/meeting-call-heading';
import { MeetingCopyButton } from '../components/meeting-copy-button';
import type { CalendarCallItem } from '../core/calendar-calls';
import { CalendarCalls } from '../views/calendar-calls';
import { CalendarCreateMenuView as CalendarCreateMenu } from '../views/calendar-create-menu';
import { CallInvite } from '../views/call-invite';
import { MeetingPage } from '../views/meeting-page';
import { createPreviewCallState } from './preview-call-state';

const previewUrl = 'https://macro.com/app/meet/preview-only';
const people = [
  {
    name: 'Eric Hayes',
    email: 'eric.hayes@macro.com',
    organizer: true,
    status: 'accepted',
    photoUrl: '/sam.png',
  },
  {
    name: 'Marcus Oduya',
    email: 'marcus@northwind.co',
    status: 'accepted',
    photoUrl: '/ness.png',
  },
  {
    name: 'Priya Natarajan',
    email: 'priya@macro.com',
    status: 'tentative',
    photoUrl: '/teo.png',
  },
];
function previewItems(): CalendarCallItem[] {
  const now = Date.now();
  const start = new Date(now + 46 * 60_000).toISOString();
  const end = new Date(now + 91 * 60_000).toISOString();
  const record = {
    id: 'preview-live',
    title: 'Design sync',
    startedAt: new Date(now - 12 * 60_000).toISOString(),
    active: true,
    people: people.map((person) => person.name),
    participants: people,
    participantCount: 6,
    channelId: 'preview-channel',
    channelName: 'design',
  };
  return [
    {
      id: 'live',
      title: 'Design sync',
      group: 'live',
      start: record.startedAt,
      record,
    },
    {
      id: 'upcoming',
      title: 'Northwind kickoff',
      group: 'scheduled',
      start,
      end,
      link: {
        id: 'preview-link',
        title: 'Northwind kickoff',
        url: previewUrl,
        shareToken: 'preview-only',
      },
      event: {
        eventId: 'preview-event',
        occurrenceKey: 'preview-occurrence',
        title: 'Northwind kickoff',
        start,
        end,
        url: previewUrl,
        account: 'eric.hayes@macro.com',
        attendees: people,
        canEdit: true,
        canInvite: true,
      },
    },
    {
      id: 'recent',
      title: 'Weekly planning',
      group: 'recent',
      start: new Date(now - 86400_000).toISOString(),
      record: {
        ...record,
        id: 'preview-record',
        title: 'Weekly planning',
        active: false,
        channelId: undefined,
        durationMs: 3600_000,
        summary: 'Aligned on the launch plan and next milestones.',
      },
    },
    {
      id: 'room',
      title: 'Eric’s room',
      group: 'instant',
      link: {
        id: 'preview-room',
        title: 'Eric’s room',
        url: previewUrl,
        shareToken: 'preview-only',
      },
    },
  ];
}

export default function CallsPreview() {
  const [items, setItems] = createSignal(previewItems());
  const [notice, setNotice] = createSignal('');
  return (
    <div class="flex size-full min-h-0 flex-col bg-surface text-ink">
      <div class="border-b border-edge-muted p-3 text-xs text-ink-muted">
        Calls preview · sample data. Hover or click a call to inspect it.
        Actions are simulated.
      </div>
      <Show when={notice()}>
        <p role="status" class="px-4 pt-3 text-xs">
          {notice()}
        </p>
      </Show>
      <div class="flex min-h-0 flex-1 flex-col sm:flex-row">
        <aside
          aria-label="Calendar sidebar preview"
          class="flex shrink-0 flex-col gap-4 border-b border-edge-muted bg-panel p-3 sm:w-56 sm:border-r sm:border-b-0"
        >
          <CalendarCreateMenu
            pending={false}
            onEvent={() => setNotice('Preview: create event')}
            onQuickCall={() =>
              setNotice('Open the join preview to try a Quick Call.')
            }
          />
          <CalendarActiveCallNotice
            title="Quick Call"
            description="Quick Call · not on the calendar"
            onJoin={() =>
              setNotice('Open the join preview to try joining a call.')
            }
            onShowCalls={() => setNotice('You are viewing the Calls preview.')}
          />
        </aside>
        <CalendarCalls
          source={{
            items,
            loading: () => false,
            refreshing: () => false,
            error: () => undefined,
            hasMore: () => false,
            refresh: () => {},
            loadMore: () => {},
          }}
          startCall={
            <div class="flex items-center gap-3 rounded-xl border border-edge-muted bg-panel p-3">
              <input
                class="min-w-0 flex-1 bg-transparent text-sm outline-none"
                placeholder="Start a Quick Call: add people by name or email…"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setNotice('Open the join preview to try joining a call.')
                }
              >
                Call
              </Button>
            </div>
          }
          renderInvite={() => (
            <CallInvite
              onInvite={async (email) => {
                setNotice(`Preview invitation to ${email}. No email was sent.`);
              }}
            />
          )}
          actions={{
            schedule: () => setNotice('Preview: create event'),
            join: async () => {
              setNotice('Open the join preview to try joining a call.');
            },
            copy: (url) => writeClipboardData({ 'text/plain': url }),
            resolveLink: async () => previewUrl,
            openRecord: () => setNotice('Preview: recording and transcript'),
            openEvent: () => setNotice('Preview: calendar event'),
            editEvent: () => setNotice('Preview: edit calendar event'),
            rename: async (id, title) => {
              setItems((all) =>
                all.map((item) =>
                  item.link?.id === id ? { ...item, title } : item
                )
              );
            },
            revoke: async (id) => {
              setItems((all) => all.filter((item) => item.link?.id !== id));
            },
          }}
        />
      </div>
    </div>
  );
}

export function JoinCallPreview(props: { startInCall?: boolean }) {
  const [member, setMember] = createSignal(Boolean(props.startInCall));
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
              source={() => ({
                kind: 'ready',
                title: title(),
                scheduledStart: null,
                scheduledEnd: null,
                channelId: null,
              })}
              authenticated={member}
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
                () => setShowInCallPreview(false),
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
