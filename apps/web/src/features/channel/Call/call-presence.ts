/** Explicit visit announcements: transport membership changes are not hangups. */
export type CallPresenceEvent = 'join' | 'leave';

export type CallPresenceMessage = {
  callId: string;
  visitId: string;
  event: CallPresenceEvent;
};

const MAX_REMEMBERED_EVENTS = 256;
const CALL_SOUND_MIN_GAP_MS = 1_500;

export function parseCallPresenceMessage(
  value: unknown
):
  | (CallPresenceMessage & { senderSid: string; traceparent?: string })
  | undefined {
  if (!value || typeof value !== 'object') return;
  if (!('callId' in value) || typeof value.callId !== 'string') return;
  if (!('visitId' in value) || typeof value.visitId !== 'string') return;
  if (
    !('senderSid' in value) ||
    typeof value.senderSid !== 'string' ||
    !value.senderSid
  )
    return;
  if (!value.callId || !value.visitId || value.visitId.length > 100) return;
  if (
    !('event' in value) ||
    (value.event !== 'join' && value.event !== 'leave')
  )
    return;
  return {
    callId: value.callId,
    visitId: value.visitId,
    event: value.event,
    senderSid: value.senderSid,
    traceparent:
      'traceparent' in value && typeof value.traceparent === 'string'
        ? value.traceparent
        : undefined,
  };
}

/** One instance per call provider, retained when recovery replaces the RTC room. */
export function createCallPresence(options: {
  play: (event: CallPresenceEvent) => void;
  createVisitId: () => string;
}) {
  let visit: { callId: string; visitId: string } | undefined;
  let initialParticipantSids = new Set<string>();
  const received = new Set<string>();
  let lastPlayedAt = Number.NEGATIVE_INFINITY;

  // New visit IDs bypass replay dedupe. Coalesce bursts rather than scheduling
  // overlapping cues, and retain the gap across local leave/rejoin cycles.
  function play(event: CallPresenceEvent) {
    const now = performance.now();
    if (now - lastPlayedAt < CALL_SOUND_MIN_GAP_MS) return false;
    lastPlayedAt = now;
    options.play(event);
    return true;
  }

  function joined(
    callId: string,
    participantSids: string[],
    recovery: boolean
  ) {
    // The initial roster never announces joins to its new observer, even if a
    // delayed reliable packet arrives after the observer finishes connecting.
    initialParticipantSids = new Set(participantSids);
    if (recovery && visit?.callId === callId) return;
    received.clear();
    visit = { callId, visitId: options.createVisitId() };
    if (recovery) return;
    play('join');
    return { ...visit, event: 'join' as const };
  }

  function clear() {
    visit = undefined;
    initialParticipantSids.clear();
    received.clear();
  }

  function left(): CallPresenceMessage | undefined {
    if (!visit) return;
    const message = { ...visit, event: 'leave' as const };
    clear();
    play('leave');
    return message;
  }

  function receive(
    message: CallPresenceMessage,
    sender: { sid: string; identity: string }
  ) {
    if (!visit || message.callId !== visit.callId) return;
    if (message.event === 'join' && initialParticipantSids.has(sender.sid))
      return;
    const key = `${sender.identity}:${message.visitId}:${message.event}`;
    if (received.has(key)) return;
    received.add(key);
    if (received.size > MAX_REMEMBERED_EVENTS) {
      const oldest = received.values().next().value;
      if (oldest !== undefined) received.delete(oldest);
    }
    return play(message.event);
  }

  return { joined, left, receive, clear };
}
