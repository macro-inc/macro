/**
 * What a session's last known runtime status means for a list row.
 *
 * Soup carries the wire name of the latest system event (`no_messages`
 * before the first, `disconnected` when the transport dropped). That is
 * coarse — it says whether a runtime is up, not whether a turn is running —
 * so the list only distinguishes a session that is coming up, one whose
 * runtime is alive, and one whose runtime has gone.
 */
export type ConversationState = 'starting' | 'live' | 'ended';

const STARTING: ReadonlySet<string> = new Set(['no_messages', 'booting']);
const ENDED: ReadonlySet<string> = new Set([
  'disconnected',
  'session/end',
  'closed',
]);

export function conversationState(
  status: string | null | undefined
): ConversationState {
  if (!status || STARTING.has(status)) return 'starting';
  if (ENDED.has(status)) return 'ended';
  return 'live';
}

export function conversationStateLabel(state: ConversationState): string {
  switch (state) {
    case 'starting':
      return 'Starting';
    case 'live':
      return 'Ready';
    case 'ended':
      return 'Ended';
  }
}
