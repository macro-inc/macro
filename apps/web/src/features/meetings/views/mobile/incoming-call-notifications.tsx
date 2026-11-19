import { For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useIncomingMeetingInvitations } from '../../context/incoming-meeting-invitations';
import { MEETING_INVITATION_RING_MS } from '../../core/meeting-invitations';
import { createRingCountdown } from '../../primitives/invitation-countdown';
import { MobileIncomingCallCard } from './incoming-call-card';

/**
 * Meeting invitations on touch devices, as before the desktop stack: phones
 * and tablets answer channel calls from Chat and their native call screens.
 * Lives outside app chrome so invites remain reachable on every route/layout.
 */
export function MobileIncomingCallNotifications() {
  const incoming = useIncomingMeetingInvitations();
  return (
    <Show when={incoming.invitations().length > 0}>
      <Portal>
        <div
          role="region"
          aria-label="Incoming calls"
          class="pointer-events-none fixed bottom-[calc(var(--mobile-content-inset-bottom,var(--safe-bottom,0px))+12px)] left-[max(1rem,env(safe-area-inset-left,0px))] z-toast-region flex max-h-[calc(100dvh-2rem)] w-88 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto"
        >
          <For each={incoming.invitations().map((item) => item.meetingId)}>
            {(meetingId) => {
              const invitation = () =>
                incoming
                  .invitations()
                  .find((item) => item.meetingId === meetingId);
              const remainingMs = createRingCountdown(
                () => invitation()?.expiresAt ?? new Date(0).toISOString(),
                MEETING_INVITATION_RING_MS
              );
              return (
                <Show when={invitation()}>
                  {(current) => (
                    <MobileIncomingCallCard
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
