import { For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { IncomingCallNotification } from '../components/incoming-call-notification';
import { useIncomingMeetingInvitations } from '../context/incoming-meeting-invitations';
import { createInvitationCountdown } from '../primitives/invitation-countdown';

/** Lives outside app chrome so invites remain reachable on every route/layout. */
export function IncomingCallNotifications() {
  const incoming = useIncomingMeetingInvitations();
  return (
    <Show when={incoming.invitations().length > 0}>
      <Portal>
        <div
          role="region"
          aria-label="Incoming calls"
          class="pointer-events-none fixed bottom-[max(1rem,var(--safe-bottom,0px))] left-[max(1rem,env(safe-area-inset-left,0px))] z-toast-region flex max-h-[calc(100dvh-2rem)] w-88 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto touch:bottom-[calc(var(--mobile-content-inset-bottom,var(--safe-bottom,0px))+12px)]"
        >
          <For each={incoming.invitations().map((item) => item.meetingId)}>
            {(meetingId) => {
              const invitation = () =>
                incoming
                  .invitations()
                  .find((item) => item.meetingId === meetingId);
              const remainingMs = createInvitationCountdown(
                () => invitation()?.expiresAt ?? new Date(0).toISOString()
              );
              return (
                <Show when={invitation()}>
                  {(current) => (
                    <IncomingCallNotification
                      title={current().title}
                      callerName={current().callerName}
                      remainingMs={remainingMs()}
                      onJoin={() => incoming.answer(current())}
                      onDecline={() => incoming.dismiss(current())}
                    />
                  )}
                </Show>
              );
            }}
          </For>
        </div>
      </Portal>
    </Show>
  );
}
