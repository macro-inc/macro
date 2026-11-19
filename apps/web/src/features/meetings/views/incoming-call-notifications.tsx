import { t } from '@app/lib/i18n';
import { MAX_RING_DURATION_MS } from '@channel/Call/CallStartedNotifier';
import { UserIcon } from '@core/component/UserIcon';
import { idToDisplayName } from '@core/user/util';
import { hasOverlayTitleBar } from '@core/util/platform';
import { cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { match } from 'ts-pattern';
import { IncomingCallNotification } from '../components/incoming-call-notification';
import { IncomingCallStack } from '../components/incoming-call-stack';
import { useIncomingChannelCalls } from '../context/incoming-channel-calls';
import { useIncomingMeetingInvitations } from '../context/incoming-meeting-invitations';
import type { IncomingChannelCall } from '../core/incoming-channel-calls';
import {
  type IncomingMeetingInvitation,
  MEETING_INVITATION_RING_MS,
} from '../core/meeting-invitations';
import { createRingCountdown } from '../primitives/invitation-countdown';
import { IncomingChannelCallNotification } from './incoming-channel-call-notification';

type RingingCall =
  | {
      kind: 'channel';
      key: string;
      startedAt: number;
      call: IncomingChannelCall;
    }
  | {
      kind: 'meeting';
      key: string;
      startedAt: number;
      invitation: IncomingMeetingInvitation;
    };

/**
 * Every ringing call, channel calls and meeting invitations alike, stacked at
 * the top of the window with the newest in front. Lives outside app chrome so
 * calls stay answerable on every route and layout, whether or not the Chat
 * sidebar is open.
 */
export function IncomingCallNotifications() {
  const incoming = useIncomingMeetingInvitations();
  const channelCalls = useIncomingChannelCalls();

  // Read reactively, like channel callers, so a name that loads after the
  // ring starts replaces the address local part.
  const invitationCallerName = (invitation: {
    createdBy: string;
    callerName: string;
  }) => idToDisplayName(invitation.createdBy) || invitation.callerName;

  const ringing = (): RingingCall[] =>
    [
      ...channelCalls.calls().map(
        (call): RingingCall => ({
          kind: 'channel',
          key: `call:${call.callId}`,
          startedAt: Date.parse(call.expiresAt) - MAX_RING_DURATION_MS,
          call,
        })
      ),
      ...incoming.invitations().map(
        (invitation): RingingCall => ({
          kind: 'meeting',
          key: `meeting:${invitation.meetingId}`,
          startedAt:
            Date.parse(invitation.expiresAt) - MEETING_INVITATION_RING_MS,
          invitation,
        })
      ),
    ].sort((a, b) => b.startedAt - a.startedAt);
  const keys = () => ringing().map((item) => item.key);
  const find = (key: string) => ringing().find((item) => item.key === key);
  const channelCall = (key: string) => {
    const item = find(key);
    return item?.kind === 'channel' ? item.call : undefined;
  };
  const meetingInvitation = (key: string) => {
    const item = find(key);
    return item?.kind === 'meeting' ? item.invitation : undefined;
  };

  // The stack stays open while any call it was opened with still rings, so it
  // folds back by itself once those calls are answered or gone.
  const [openedWith, setOpenedWith] = createSignal<string[]>([]);
  const expanded = () => keys().some((key) => openedWith().includes(key));

  const announcedName = (item: RingingCall) =>
    match(item)
      .with(
        { kind: 'channel' },
        ({ call }) => call.callerName || t('calls.someone')
      )
      .with({ kind: 'meeting' }, ({ invitation }) =>
        invitationCallerName(invitation)
      )
      .exhaustive();

  return (
    <>
      {/* Always mounted, so screen readers announce each call as it rings;
          a live region added together with its content is not announced.
          Keyed by call, so a name that loads late updates its line instead of
          adding a second announcement. */}
      <div class="sr-only" aria-live="polite">
        <For each={keys()}>
          {(key) => {
            const name = () => {
              const item = find(key);
              return item ? announcedName(item) : '';
            };
            return <p>{t('calls.incomingCallFrom', { name: name() })}</p>;
          }}
        </For>
      </div>
      <Show when={keys().length > 0}>
        <Portal>
          <div
            role="region"
            aria-label={t('calls.incomingCalls')}
            class={cn(
              // Scrolls when the open stack is taller than a short screen; the
              // padding keeps the cards' shadows inside the scroll box.
              'pointer-events-none fixed left-(--safe-left) right-(--safe-right) z-toast-region mx-auto max-w-[32rem] overflow-y-auto overscroll-contain px-4 pt-3 pb-6',
              // The macOS app's title bar overlays the page's top 40px.
              hasOverlayTitleBar()
                ? 'top-10 max-h-[calc(100dvh-2.5rem)]'
                : 'top-[calc(var(--safe-top,0px)+4px)] max-h-[calc(100dvh-var(--safe-top,0px)-var(--safe-bottom,0px)-4px)]'
            )}
          >
            <IncomingCallStack
              keys={keys()}
              expanded={expanded()}
              onExpand={() => setOpenedWith(keys())}
              onCollapse={() => setOpenedWith([])}
            >
              {(key, concealed) => (
                <>
                  <Show when={channelCall(key)}>
                    {(call) => (
                      <IncomingChannelCallNotification
                        call={call()}
                        concealed={concealed()}
                        onJoin={() => channelCalls.join(call())}
                        onDecline={() => channelCalls.decline(call())}
                      />
                    )}
                  </Show>
                  <Show when={meetingInvitation(key)}>
                    {(invitation) => (
                      <MeetingInvitationNotification
                        invitation={invitation()}
                        callerName={invitationCallerName(invitation())}
                        concealed={concealed()}
                        onJoin={() => incoming.answer(invitation())}
                        onDecline={() => incoming.dismiss(invitation())}
                      />
                    )}
                  </Show>
                </>
              )}
            </IncomingCallStack>
          </div>
        </Portal>
      </Show>
    </>
  );
}

/** A meeting invitation in the stack: the call is to you, like a DM. */
function MeetingInvitationNotification(props: {
  invitation: IncomingMeetingInvitation;
  callerName: string;
  concealed: boolean;
  onJoin: () => void;
  onDecline: () => void;
}) {
  const remainingMs = createRingCountdown(
    () => props.invitation.expiresAt,
    MEETING_INVITATION_RING_MS
  );
  return (
    <IncomingCallNotification
      avatar={
        <UserIcon
          id={props.invitation.createdBy}
          name={props.callerName}
          size="lg"
          class="size-12"
          suppressClick
          showTooltip={false}
        />
      }
      callerName={props.callerName}
      detail={t('calls.callingYou')}
      remainingMs={remainingMs()}
      ringDurationMs={MEETING_INVITATION_RING_MS}
      concealed={props.concealed}
      onJoin={props.onJoin}
      onDecline={props.onDecline}
    />
  );
}
