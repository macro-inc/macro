/**
 * The messages exchanged with the agent-fold worker.
 *
 * Request/response pairs correlated by `id`, because one worker serves every
 * agent channel a session might have open and replies can interleave.
 */

import type { AgentSessionLogEntryDto } from '@service-storage/generated/schemas/agentSessionLogEntryDto';
import type { FoldedMessage } from './types';

/** Fold this session's log. */
export interface FoldRequest {
  id: number;
  sessionId: string;
  entries: AgentSessionLogEntryDto[];
}

/** What the worker sends back, one per request. */
export type FoldResponse =
  | { id: number; ok: true; messages: FoldedMessage[] }
  | { id: number; ok: false; error: string };
