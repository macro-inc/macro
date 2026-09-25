import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  type IncomingMeetingInvitation,
  MEETING_INVITATION_RING_MS,
  type MeetingInvitation,
  type MeetingInvitationResolution,
  meetingInvitationRingKey,
} from '../core/meeting-invitations';

const MAX_RESOLVED_MEETINGS = 100;

type InvitationResources = {
  stopRing: () => void;
  closeNotification?: () => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type IncomingMeetingInvitationCapabilities = {
  userId: Accessor<string | undefined>;
  ring: (
    key: string,
    shouldStop: () => boolean,
    durationMs: number
  ) => () => void;
  callerName: (userId: string) => Promise<string | undefined>;
  notify: (
    invitation: IncomingMeetingInvitation,
    handlers: { answer: () => void; dismiss: () => void }
  ) => Promise<(() => void) | undefined>;
  publishResolution: (resolution: MeetingInvitationResolution) => void;
  openMeeting: (shareToken: string) => void;
};

/** Owns pending invitations and their ring/notification lifetimes for one app. */
export function createIncomingMeetingInvitations(
  capabilities: IncomingMeetingInvitationCapabilities
) {
  const [invitations, setInvitations] = createSignal<
    IncomingMeetingInvitation[]
  >([]);
  const resources = new Map<string, InvitationResources>();
  const resolvedThrough = new Map<string, number>();

  const keyOf = (invitation: IncomingMeetingInvitation) =>
    meetingInvitationRingKey(invitation, invitation.recipientId);
  const isCurrent = (invitation: IncomingMeetingInvitation) =>
    capabilities.userId() === invitation.recipientId &&
    invitations().some((current) => keyOf(current) === keyOf(invitation));

  function remove(invitation: IncomingMeetingInvitation) {
    const key = keyOf(invitation);
    setInvitations((current) => current.filter((item) => keyOf(item) !== key));
    const resource = resources.get(key);
    resources.delete(key);
    if (!resource) return;
    clearTimeout(resource.timeout);
    resource.stopRing();
    resource.closeNotification?.();
  }

  function resolve(resolution: MeetingInvitationResolution) {
    if (resolution.userId !== capabilities.userId()) return;
    const previous = resolvedThrough.get(resolution.meetingId) ?? 0;
    const cutoff = Math.max(previous, Date.parse(resolution.resolvedAt));
    resolvedThrough.set(resolution.meetingId, cutoff);
    if (resolvedThrough.size > MAX_RESOLVED_MEETINGS) {
      const oldest = resolvedThrough.keys().next().value;
      if (oldest !== undefined) resolvedThrough.delete(oldest);
    }
    for (const invitation of invitations()) {
      if (
        invitation.meetingId === resolution.meetingId &&
        Date.parse(invitation.invitedAt) <= cutoff
      ) {
        remove(invitation);
      }
    }
  }

  function dismiss(invitation: IncomingMeetingInvitation) {
    if (!isCurrent(invitation)) return;
    const resolution = {
      meetingId: invitation.meetingId,
      userId: invitation.recipientId,
      resolvedAt: invitation.invitedAt,
    };
    resolve(resolution);
    capabilities.publishResolution(resolution);
  }

  function answer(invitation: IncomingMeetingInvitation) {
    if (!isCurrent(invitation)) return;
    dismiss(invitation);
    capabilities.openMeeting(invitation.shareToken);
  }

  async function notify(invitation: IncomingMeetingInvitation) {
    try {
      const name = await capabilities.callerName(invitation.createdBy);
      if (!isCurrent(invitation)) return;
      const named = {
        ...invitation,
        callerName: name || invitation.callerName,
      };
      setInvitations((items) =>
        items.map((item) => (keyOf(item) === keyOf(invitation) ? named : item))
      );
      const close = await capabilities.notify(named, {
        answer: () => answer(named),
        dismiss: () => dismiss(named),
      });
      const resource = resources.get(keyOf(invitation));
      if (!resource || !isCurrent(invitation)) {
        close?.();
        return;
      }
      resource.closeNotification = close;
    } catch (error) {
      // The in-app invitation and audio remain available if a toast fails.
      console.warn('Could not show meeting invitation notification', error);
    }
  }

  function receive(event: MeetingInvitation) {
    const recipientId = capabilities.userId();
    if (!recipientId || event.createdBy === recipientId) return;
    const now = Date.now();
    const durationMs = Math.min(
      MEETING_INVITATION_RING_MS,
      Date.parse(event.expiresAt) - now
    );
    if (
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      Date.parse(event.invitedAt) <= (resolvedThrough.get(event.meetingId) ?? 0)
    )
      return;
    const previous = invitations().find(
      (item) => item.meetingId === event.meetingId
    );
    if (
      previous &&
      Date.parse(previous.invitedAt) >= Date.parse(event.invitedAt)
    )
      return;
    if (previous) remove(previous);
    const invitation = {
      ...event,
      // The visual countdown and dismissal timer share the same capped deadline.
      expiresAt: new Date(now + durationMs).toISOString(),
      recipientId,
      callerName: 'Someone',
    };
    const key = keyOf(invitation);
    setInvitations((items) => [invitation, ...items]);
    const stopRing = capabilities.ring(
      key,
      () => !isCurrent(invitation),
      durationMs
    );
    resources.set(key, {
      stopRing,
      timeout: setTimeout(() => remove(invitation), durationMs),
    });
    void notify(invitation);
  }

  function answered(event: { meetingId: string; userId: string }) {
    if (event.userId !== capabilities.userId()) return;
    const invitation = invitations().find(
      (item) => item.meetingId === event.meetingId
    );
    const resolution = {
      ...event,
      resolvedAt: new Date(
        Math.max(Date.now(), invitation ? Date.parse(invitation.invitedAt) : 0)
      ).toISOString(),
    };
    resolve(resolution);
    capabilities.publishResolution(resolution);
  }

  function clear() {
    for (const invitation of invitations()) remove(invitation);
    resolvedThrough.clear();
  }

  createEffect(on(capabilities.userId, clear, { defer: true }));
  onCleanup(clear);

  return { invitations, receive, resolve, answer, dismiss, answered };
}
