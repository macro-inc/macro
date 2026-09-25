import type { MeetingInvitation } from '@app/features/meetings/core/meeting-invitations';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';

export type MeetingAnsweredEvent = { meetingId: string; userId: string };
type MeetingInvitationEvent =
  | ({ type: 'meeting_invited' } & MeetingInvitation)
  | ({ type: 'meeting_answered' } & MeetingAnsweredEvent);

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeInvitationPayload(rawData: unknown): unknown {
  if (typeof rawData !== 'string') return rawData;
  try {
    return JSON.parse(rawData);
  } catch {
    // Invitation payloads contain bearer share tokens. Never log the raw
    // frame or JSON parse error (which may include part of that frame).
    return null;
  }
}

/** Normalize the dedicated targeted meeting events emitted by the call service. */
export function parseMeetingInvitationEvent(
  type: string,
  rawData: unknown
): MeetingInvitationEvent | null {
  if (type !== 'meeting_invited' && type !== 'meeting_answered') return null;
  const data = decodeInvitationPayload(rawData);
  if (!isRecord(data) || !nonemptyString(data.meeting_id)) return null;
  if (type === 'meeting_answered') {
    if (!nonemptyString(data.user_id)) return null;
    return { type, meetingId: data.meeting_id, userId: data.user_id };
  }
  if (
    !nonemptyString(data.share_token) ||
    typeof data.title !== 'string' ||
    !nonemptyString(data.created_by) ||
    !nonemptyString(data.invited_at) ||
    !nonemptyString(data.expires_at)
  )
    return null;
  const invitedAt = Date.parse(data.invited_at);
  const expiresAt = Date.parse(data.expires_at);
  if (
    !Number.isFinite(invitedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= invitedAt
  )
    return null;
  return {
    type,
    meetingId: data.meeting_id,
    shareToken: data.share_token,
    title: data.title,
    createdBy: data.created_by,
    invitedAt: data.invited_at,
    expiresAt: data.expires_at,
  };
}

export function createMeetingInvitationEventsEffect(handlers: {
  onInvited: (event: MeetingInvitation) => void;
  onAnswered: (event: MeetingAnsweredEvent) => void;
}) {
  const userId = useUserId();
  createConnectionWebsocketEffect((frame) => {
    if (!ENABLE_CALLS || !userId()) return;
    const event = parseMeetingInvitationEvent(frame.type, frame.data);
    if (!event) return;
    if (event.type === 'meeting_answered') {
      if (event.userId === userId()) handlers.onAnswered(event);
      return;
    }
    if (event.createdBy !== userId()) handlers.onInvited(event);
  });
}
