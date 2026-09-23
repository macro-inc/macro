import { getMeetingPath, getMeetingShareToken } from '@channel/Call/call-link';
import ChatsIcon from '@phosphor/chats.svg';
import PhoneCallIcon from '@phosphor-fill/phone-call-fill.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { LiveCallsSidebar } from '../components/live-calls-sidebar';
import { IncomingMeetingInvitationsContext } from '../context/incoming-meeting-invitations';
import { createIncomingMeetingInvitations } from '../primitives/incoming-meeting-invitations';
import { IncomingCallNotifications } from '../views/incoming-call-notifications';

/** Exercises the production incoming-call UI with entirely local capabilities. */
export default function IncomingCallPreview() {
  const [status, setStatus] = createSignal(
    'Ready to preview an incoming call.'
  );
  const [liveCallVisible, setLiveCallVisible] = createSignal(false);
  const [liveStatus, setLiveStatus] = createSignal('No active calls.');
  let invitationNumber = 0;
  const incoming = createIncomingMeetingInvitations({
    userId: () => 'macro|preview-recipient@example.com',
    callerName: async () => 'Maya Chen',
    ring: () => () => {},
    notify: async () => undefined,
    publishResolution: () => {},
    openMeeting: (shareToken) => {
      setStatus(`Join would open ${getMeetingPath(shareToken)}`);
    },
  });

  function showInvitation() {
    const now = Date.now();
    incoming.receive({
      meetingId: `preview-incoming-${++invitationNumber}`,
      shareToken: 'preview-only',
      title: 'Design review',
      createdBy: 'macro|maya.chen@example.com',
      invitedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 30_000).toISOString(),
    });
    setStatus('Maya Chen is calling about Design review.');
  }

  return (
    <IncomingMeetingInvitationsContext.Provider
      value={{
        invitations: incoming.invitations,
        answer: incoming.answer,
        dismiss: (invitation) => {
          incoming.dismiss(invitation);
          setStatus('Call declined in preview.');
        },
      }}
    >
      <main class="flex h-full flex-col items-start gap-4 bg-surface p-6 text-ink">
        <h1 class="text-xl font-semibold">Incoming call preview</h1>
        <p class="text-sm text-ink-muted">
          Simulated invitation from Maya Chen. The card expires after 30
          seconds.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={incoming.invitations().length > 0}
          onClick={showInvitation}
        >
          Show incoming call
        </Button>
        <p role="status" class="text-sm text-ink-muted">
          {status()}
        </p>
        <h2 class="text-base font-semibold">Chat sidebar preview</h2>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={liveCallVisible()}
            onClick={() => {
              setLiveCallVisible(true);
              setLiveStatus('Design review is active in preview.');
            }}
          >
            Show live call
          </Button>
          <Button
            variant="outline"
            disabled={!liveCallVisible()}
            onClick={() => {
              setLiveCallVisible(false);
              setLiveStatus('No active calls.');
            }}
          >
            End live call
          </Button>
        </div>
        <div
          aria-label="Channels navigation indicator preview"
          class="flex w-64 items-center gap-2 rounded-lg border border-edge-muted bg-panel px-3 py-2 text-sm"
        >
          <ChatsIcon aria-hidden="true" class="size-4" />
          <span class="flex-1">Channels</span>
          <Show when={liveCallVisible()}>
            <PhoneCallIcon
              role="img"
              aria-label="Active call"
              class="size-4 shrink-0 text-accent"
            />
          </Show>
        </div>
        <aside
          aria-label="Chat navigation preview"
          class="flex h-64 w-64 min-h-0 flex-col gap-3 rounded-xl border border-edge-muted bg-panel py-3"
        >
          <div class="px-(--sidebar-content-inset) text-sm font-semibold">
            Chat
          </div>
          <LiveCallsSidebar
            calls={
              liveCallVisible()
                ? [
                    {
                      id: 'preview-live-call',
                      label: 'Call with Maya Chen',
                      url: getMeetingPath(
                        '0194b799-cafe-7000-8000-000000000001'
                      ),
                    },
                  ]
                : []
            }
            onJoin={(call) => {
              const token = getMeetingShareToken(call.url);
              if (token)
                setLiveStatus(`Join would open ${getMeetingPath(token)}`);
            }}
          />
          <div class="px-(--sidebar-content-inset) text-xs text-ink-muted">
            Conversations remain here.
          </div>
        </aside>
        <p role="status" class="text-sm text-ink-muted">
          {liveStatus()}
        </p>
      </main>
      <IncomingCallNotifications />
    </IncomingMeetingInvitationsContext.Provider>
  );
}
