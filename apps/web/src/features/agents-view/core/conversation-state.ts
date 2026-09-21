/**
 * What a session's last known runtime status, and its fold turn, mean for a
 * list row.
 *
 * Soup carries the wire name of the latest system event (`no_messages`
 * before the first, `disconnected` when the transport dropped). That is
 * coarse — it says whether a runtime is up, not whether a turn is running.
 * The fold's `turn` fills that gap: an open turn is work in progress, even
 * when the last system event was just `acp_ready`.
 */

import { isWorkingTurn } from '@core/agent-session/session-turn';
import type { TurnState } from '@service-agent-fold/generated/types';

export type ConversationState = 'starting' | 'working' | 'live' | 'ended';

const STARTING: ReadonlySet<string> = new Set(['no_messages', 'booting']);
const ENDED: ReadonlySet<string> = new Set([
  'disconnected',
  'session/end',
  'closed',
]);

export function conversationState(
  status: string | null | undefined,
  turn?: TurnState | null
): ConversationState {
  if (isWorkingTurn(turn)) return 'working';
  if (!status || STARTING.has(status)) return 'starting';
  if (ENDED.has(status)) return 'ended';
  return 'live';
}

export function conversationStateLabel(state: ConversationState): string {
  switch (state) {
    case 'starting':
      return 'Starting';
    case 'working':
      return 'Working';
    case 'live':
      return 'Ready';
    case 'ended':
      return 'Ended';
  }
}
