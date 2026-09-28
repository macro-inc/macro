import type { MeetingInvitationResolution } from '@app/features/meetings/core/meeting-invitations';
import { createCrossTabBus } from '@core/cross-tab/cross-tab-bus';

function parseResolution(value: unknown): MeetingInvitationResolution | null {
  if (!value || typeof value !== 'object') return null;
  if (
    !('meetingId' in value) ||
    typeof value.meetingId !== 'string' ||
    !('userId' in value) ||
    typeof value.userId !== 'string' ||
    !('resolvedAt' in value) ||
    typeof value.resolvedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.resolvedAt))
  )
    return null;
  return {
    meetingId: value.meetingId,
    userId: value.userId,
    resolvedAt: value.resolvedAt,
  };
}

const resolutions = createCrossTabBus<MeetingInvitationResolution>({
  channelName: 'macro-meeting-invitation-resolution',
  storageKey: 'macro.meeting-invitation-resolution',
  parse: parseResolution,
  getMessageKey: (message) =>
    `${message.userId}:${message.meetingId}:${message.resolvedAt}`,
});

export const publishMeetingInvitationResolution = resolutions.publish;
export const subscribeToMeetingInvitationResolutions = resolutions.subscribe;
