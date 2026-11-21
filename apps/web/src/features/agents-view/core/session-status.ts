import type { ConversationState } from './conversation-state';

export type SessionStatus =
  | 'idle'
  | 'working'
  | 'waiting'
  | 'unread'
  | 'failed';

/** Waiting rows use an unread mark; the section heading carries the waiting state. */
export function sessionRowStatus(
  state: ConversationState,
  failed: boolean,
  unread: boolean,
  waiting: boolean
): SessionStatus {
  if (waiting) return 'unread';
  if (state === 'working' || state === 'starting') return 'working';
  if (failed) return 'failed';
  if (unread) return 'unread';
  return 'idle';
}
