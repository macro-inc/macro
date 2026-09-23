/**
 * The persisted fold turn is authoritative for list activity. Older rows
 * without a projection fall back to the last runtime lifecycle event.
 */

import { match } from 'ts-pattern';

export type ConversationState = 'starting' | 'working' | 'waiting' | 'dormant';

const STARTING: ReadonlySet<string> = new Set(['no_messages', 'booting']);

export function conversationState(
  status: string | null | undefined,
  turn?: string | null
): ConversationState {
  if (turn === 'blocked') return 'waiting';
  if (turn === 'running' || turn === 'stopping') return 'working';
  if (turn === 'starting') return 'starting';
  if (turn === 'disconnected') return 'dormant';
  if (!status || STARTING.has(status)) return 'starting';
  return 'dormant';
}

export function conversationStateLabel(state: ConversationState): string {
  return match(state)
    .with('starting', () => 'Starting')
    .with('working', () => 'Working')
    .with('waiting', () => 'Waiting for input')
    .with('dormant', () => 'Dormant')
    .exhaustive();
}
