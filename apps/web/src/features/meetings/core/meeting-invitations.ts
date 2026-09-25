export const MEETING_INVITATION_RING_MS = 30_000;

/** A targeted invitation to a reusable meeting, independent of a live session. */
export type MeetingInvitation = {
  meetingId: string;
  shareToken: string;
  title: string;
  createdBy: string;
  invitedAt: string;
  expiresAt: string;
};

export type IncomingMeetingInvitation = MeetingInvitation & {
  recipientId: string;
  callerName: string;
};

/** Resolves invitations through this timestamp for only the answering account. */
export type MeetingInvitationResolution = {
  meetingId: string;
  userId: string;
  resolvedAt: string;
};

/** A new invitation can ring again after an earlier one was silenced. */
export function meetingInvitationRingKey(
  invitation: MeetingInvitation,
  userId: string
): string {
  return `meeting:${invitation.meetingId}:${userId}:${invitation.invitedAt}`;
}
