import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { idToDisplayName } from '@core/user/util';
import { hasOverlayTitleBar } from '@core/util/platform';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { IncomingCallNotification } from '../components/incoming-call-notification';
import { useIncomingChannelCalls } from '../context/incoming-channel-calls';
import { useIncomingMeetingInvitations } from '../context/incoming-meeting-invitations';
import { MEETING_INVITATION_RING_MS } from '../core/meeting-invitations';
import { createRingCountdown } from '../primitives/invitation-countdown';
import { IncomingChannelCallNotification } from './incoming-channel-call-notification';

/**
 * Every ringing call, channel calls and meeting invitations alike, stacked at
 * the top of the window. Lives outside app chrome so calls stay answerable on
 * every route and layout, whether or not the Chat sidebar is open.
 */
export function IncomingCallNotifications() {
  const incoming = useIncomingMeetingInvitations();
  const channelCalls = useIncomingChannelCalls();
  const hasCalls = () =>
    channelCalls.calls().length > 0 || incoming.invitations().length > 0;

  // Read reactively, like channel callers, so a name that loads after the
  // ring starts replaces the address local part.
  const invitationCallerName = (invitation: {
    createdBy: string;
    callerName: string;
  }) => idToDisplayName(invitation.createdBy) || invitation.callerName;

  // Keyed by call, so a name that loads late updates its line instead of
  // adding a second announcement.
  const announcements = () => [
    ...channelCalls.calls().map((call) => ({
      key: `call:${call.callId}`,
      name: () => call.callerName || t('calls.someone'),
    })),
    ...incoming.invitations().map((invitation) => ({
      key: `meeting:${invitation.meetingId}`,
      name: () => invitationCallerName(invitation),
    })),
  ];

  return (
    <>
      {/* Always mounted, so screen readers announce each call as it rings;
          a live region added together with its content is not announced. */}
      <div class="sr-only" aria-live="polite">
        <For each={announcements().map((item) => item.key)}>
          {(key) => {
            const name = () =>
              announcements()
                .find((item) => item.key === key)
                ?.name() ?? '';
            return <p>{t('calls.incomingCallFrom', { name: name() })}</p>;
          }}
        </For>
      </div>
      <Show when={hasCalls()}>
        <Portal>
          <div
            role="region"
            aria-label={t('calls.incomingCalls')}
            class={cn(
              // Scrolls when many calls ring on a short screen; the padding
              // keeps the cards' shadows inside the scroll box.
              'pointer-events-none fixed left-(--safe-left) right-(--safe-right) z-toast-region mx-auto flex max-w-[32rem] flex-col gap-3 overflow-y-auto overscroll-contain px-4 pt-3 pb-6',
              // The macOS app's title bar overlays the page's top 40px.
              hasOverlayTitleBar()
                ? 'top-10 max-h-[calc(100dvh-2.5rem)]'
                : 'top-[calc(var(--safe-top,0px)+4px)] max-h-[calc(100dvh-var(--safe-top,0px)-var(--safe-bottom,0px)-4px)]'
            )}
          >
            <For each={channelCalls.calls()}>
              {(call) => (
                <IncomingChannelCallNotification
                  call={call}
                  onJoin={() => channelCalls.join(call)}
                  onDecline={() => channelCalls.decline(call)}
                />
              )}
            </For>
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
                      <IncomingCallNotification
                        avatar={
                          <UserIcon
                            id={current().createdBy}
                            name={invitationCallerName(current())}
                            size="lg"
                            class="size-12"
                            suppressClick
                            showTooltip={false}
                          />
                        }
                        callerName={invitationCallerName(current())}
                        detail={
                          current().title
                            ? t('calls.callingYouAbout', {
                                title: current().title,
                              })
                            : t('calls.callingYou')
                        }
                        remainingMs={remainingMs()}
                        ringDurationMs={MEETING_INVITATION_RING_MS}
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
    </>
  );
}
