import { startCallRinger } from '@channel/Call/CallStartedNotifier';
import { getMeetingPath } from '@channel/Call/call-link';
import { createMeetingInvitationEventsEffect } from '@channel/Call/meeting-invitation-events';
import {
  publishMeetingInvitationResolution,
  subscribeToMeetingInvitationResolutions,
} from '@channel/Call/meeting-invitation-resolution';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { usePlatformNotificationState } from '@notifications';
import { DefaultUserNameResolver } from '@notifications/notification-resolvers';
import { invalidateActiveMeetings } from '@queries/call/meetings';
import { useNavigate } from '@solidjs/router';
import { onCleanup, type ParentProps, Show } from 'solid-js';
import { callerDisplayName } from './caller-name';
import { IncomingChannelCallsContext } from './context/incoming-channel-calls';
import { IncomingMeetingInvitationsContext } from './context/incoming-meeting-invitations';
import {
  MEETING_INVITATION_RING_MS,
  type MeetingInvitation,
  meetingInvitationRingKey,
} from './core/meeting-invitations';
import { createIncomingChannelCalls } from './incoming-channel-calls';
import { createIncomingMeetingInvitations } from './primitives/incoming-meeting-invitations';
import { IncomingCallNotifications } from './views/incoming-call-notifications';
import { MobileIncomingCallNotifications } from './views/mobile/incoming-call-notifications';

/**
 * App-wide receiver for incoming calls (meeting invitations and ringing channel
 * calls), mounted under the router so Answer opens meeting setup.
 */
export function IncomingMeetingInvitationsProvider(props: ParentProps) {
  return (
    <>
      {props.children}
      <IncomingMeetingInvitationsReceiver />
    </>
  );
}

function IncomingMeetingInvitationsReceiver() {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const userId = useUserId();
  const navigate = useNavigate();
  const notification = usePlatformNotificationState();
  const incoming = createIncomingMeetingInvitations({
    userId,
    ring: (key, shouldStop, duration) =>
      startCallRinger(key, shouldStop, duration).stop,
    // Touch devices keep the names they showed before the desktop stack.
    callerName: (id) =>
      isTouchDevice() ? DefaultUserNameResolver(id) : callerDisplayName(id),
    publishResolution: publishMeetingInvitationResolution,
    openMeeting: (shareToken) => navigate(getMeetingPath(shareToken)),
    notify: async (invitation, handlers) => {
      if (notification === 'not-supported') return;
      const handle = await notification.showNotification({
        title: invitation.title || 'Incoming call',
        options: {
          body: `${invitation.callerName} is calling`,
          requireInteraction: true,
          tag: meetingInvitationRingKey(invitation, invitation.recipientId),
        },
      });
      if (handle === 'not-granted' || handle === 'disabled-in-ui') return;
      handle.onClick(() => {
        window.focus();
        handlers.answer();
      });
      handle.onDismiss(handlers.dismiss);
      return () => handle.close();
    },
  });
  onCleanup(subscribeToMeetingInvitationResolutions(incoming.resolve));
  if (DEV_MODE_ENV) installDebugMeetingInvitation(incoming.receive);
  createMeetingInvitationEventsEffect({
    onInvited: (event) => {
      if (disposed) return;
      incoming.receive(event);
      const recipientId = userId();
      if (recipientId)
        fireAndForget(invalidateActiveMeetings(recipientId), 'meetings');
    },
    onAnswered: (event) => {
      if (disposed) return;
      incoming.answered(event);
      if (event.userId === userId())
        fireAndForget(invalidateActiveMeetings(event.userId), 'meetings');
    },
  });
  return (
    <IncomingMeetingInvitationsContext.Provider value={incoming}>
      <IncomingChannelCallsContext.Provider
        value={createIncomingChannelCalls()}
      >
        {/* Phones and tablets keep their own incoming call UI; the stack
            at the top of the window is desktop only. */}
        <Show when={isTouchDevice()} fallback={<IncomingCallNotifications />}>
          <MobileIncomingCallNotifications />
        </Show>
      </IncomingChannelCallsContext.Provider>
    </IncomingMeetingInvitationsContext.Provider>
  );
}

declare global {
  interface Window {
    macroDebugMeetingInvitation?: (options: {
      createdBy: string;
      title?: string;
    }) => void;
  }
}

/**
 * Dev-only `window.macroDebugMeetingInvitation({ createdBy })`: rings a
 * meeting invitation with no server record, to check the incoming call
 * stack. Its Join opens a meeting link that does not exist.
 */
function installDebugMeetingInvitation(
  receive: (invitation: MeetingInvitation) => void
) {
  window.macroDebugMeetingInvitation = (options) => {
    const now = Date.now();
    receive({
      meetingId: `debug-${crypto.randomUUID()}`,
      shareToken: 'debug',
      title: options.title ?? 'Quick Call',
      createdBy: options.createdBy,
      invitedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + MEETING_INVITATION_RING_MS).toISOString(),
    });
  };
  onCleanup(() => {
    delete window.macroDebugMeetingInvitation;
  });
}
