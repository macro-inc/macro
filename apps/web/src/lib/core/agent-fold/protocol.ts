/**
 * The messages exchanged with the agent-fold worker.
 *
 * Request/response pairs correlated by `id`, because one worker serves every
 * agent channel a session might have open and replies can interleave.
 *
 * The worker keeps one fold machine per `sessionId`, which is what makes
 * {@link FoldOpenRequest} and {@link FoldPushRequest} halves of one thing
 * rather than two ways to fold: a channel opened mid-session catches up by
 * opening the machine with its fetched log and then pushes live frames into
 * that same machine. Two machines over two halves of one log would derive the
 * same messages twice.
 */

import type {
  FoldedMessage,
  FoldedStreamEvent,
} from '@service-agent-fold/generated/types';
import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';

/**
 * Open (or reopen) a session's machine and seed it with a fetched log.
 *
 * Always starts a fresh machine: the entries are a snapshot from the top of
 * the log, so folding them into a machine that already holds them would
 * double-count. A caller that has been following the session and does not
 * want to lose that state simply does not send this.
 */
export interface FoldOpenRequest {
  id: number;
  kind: 'open';
  sessionId: string;
  entries: AgentSessionLogEntryDto[];
}

/** Fold more frames into an already-open session, in log order. */
export interface FoldPushRequest {
  id: number;
  kind: 'push';
  sessionId: string;
  entries: AgentSessionLogEntryDto[];
}

/**
 * Read an open session's messages without folding anything.
 *
 * What a second reader of an already-followed session asks, instead of
 * opening the machine again and throwing away the frames it has folded since
 * that reader's snapshot was taken.
 */
export interface FoldMessagesRequest {
  id: number;
  kind: 'messages';
  sessionId: string;
}

/** Drop a session's machine and its wasm memory. */
export interface FoldCloseRequest {
  id: number;
  kind: 'close';
  sessionId: string;
}

/** Fold a log with no machine kept — the one-shot form. */
export interface FoldOnceRequest {
  id: number;
  kind: 'once';
  sessionId: string;
  entries: AgentSessionLogEntryDto[];
}

export type FoldRequest =
  | FoldOpenRequest
  | FoldPushRequest
  | FoldMessagesRequest
  | FoldCloseRequest
  | FoldOnceRequest;

/** What the worker sends back, one per request. */
export type FoldResponse =
  | {
      id: number;
      ok: true;
      kind: 'open' | 'once' | 'messages';
      messages: FoldedMessage[];
    }
  | { id: number; ok: true; kind: 'push'; changes: FoldedStreamEvent[] }
  | { id: number; ok: true; kind: 'close' }
  | { id: number; ok: false; error: string };
