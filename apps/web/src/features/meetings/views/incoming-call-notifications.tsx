import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
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

  return (
    <Show when={hasCalls()}>
      <Portal>
        <div
          role="region"
          aria-label={t('calls.incomingCalls')}
          class={cn(
            // Not a scroller: clipping would cut off the cards' shadows.
            'pointer-events-none fixed left-(--safe-left) right-(--safe-right) z-toast-region mx-auto flex max-w-[32rem] flex-col gap-3 px-4',
            // The macOS app's title bar overlays the page's top 40px.
            hasOverlayTitleBar()
              ? 'top-12'
              : 'top-[calc(var(--safe-top,0px)+12px)]'
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
                          name={current().callerName}
                          size="lg"
                          class="size-12"
                          suppressClick
                          showTooltip={false}
                        />
                      }
                      callerName={current().callerName}
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
  );
}
