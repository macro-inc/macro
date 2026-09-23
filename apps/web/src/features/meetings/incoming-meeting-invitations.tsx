import { startCallRinger } from '@channel/Call/CallStartedNotifier';
import { getMeetingPath } from '@channel/Call/call-link';
import { createMeetingInvitationEventsEffect } from '@channel/Call/meeting-invitation-events';
import {
  publishMeetingInvitationResolution,
  subscribeToMeetingInvitationResolutions,
} from '@channel/Call/meeting-invitation-resolution';
import { useUserId } from '@core/context/user';
import { usePlatformNotificationState } from '@notifications';
import { DefaultUserNameResolver } from '@notifications/notification-resolvers';
import { invalidateActiveMeetings } from '@queries/call/meetings';
import { useNavigate } from '@solidjs/router';
import { onCleanup, type ParentProps } from 'solid-js';
import { IncomingMeetingInvitationsContext } from './context/incoming-meeting-invitations';
import { meetingInvitationRingKey } from './core/meeting-invitations';
import { createIncomingMeetingInvitations } from './primitives/incoming-meeting-invitations';
import { IncomingCallNotifications } from './views/incoming-call-notifications';

/** App-wide receiver, mounted under the router so Answer opens meeting setup. */
export function IncomingMeetingInvitationsProvider(props: ParentProps) {
  const userId = useUserId();
  const navigate = useNavigate();
  const notification = usePlatformNotificationState();
  const incoming = createIncomingMeetingInvitations({
    userId,
    ring: (key, shouldStop, duration) =>
      startCallRinger(key, shouldStop, duration).stop,
    callerName: DefaultUserNameResolver,
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
  createMeetingInvitationEventsEffect({
    onInvited: (event) => {
      incoming.receive(event);
      const recipientId = userId();
      if (recipientId) void invalidateActiveMeetings(recipientId);
    },
    onAnswered: (event) => {
      incoming.answered(event);
      if (event.userId === userId())
        void invalidateActiveMeetings(event.userId);
    },
  });
  return (
    <IncomingMeetingInvitationsContext.Provider value={incoming}>
      {props.children}
      <IncomingCallNotifications />
    </IncomingMeetingInvitationsContext.Provider>
  );
}
