/**
 * The messages exchanged with the agent-fold worker.
 *
 * Request/response pairs correlated by `id`, because one worker serves every
 * agent surface a session might have open and replies can interleave.
 *
 * The worker keeps one fold machine per `sessionId`, created on the first
 * `push` and fed every input after it in order: the fetched log as a
 * snapshot, confirmed rows as they stream in, and this client's own actions
 * the moment they are issued. One machine over one ordered input stream is
 * what keeps a surface opened mid-session from deriving the same messages
 * twice.
 */

import type {
  FoldedMessage,
  FoldedStreamEvent,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import type {
  AgentAction,
  AgentSessionLogEntryDto,
} from '@service-agent-harness/generated/schemas';

/**
 * One thing that can happen to a client's view of a session log. Mirrors
 * `FoldInput` in `crates/agent_fold/src/domain/speculation.rs`.
 */
export type FoldInput =
  /**
   * Authoritative history from the top of the log. Resets the machine's
   * confirmed tier and settles any speculation the rows already contain.
   * Must be the first input a session's machine sees.
   */
  | { kind: 'snapshot'; rows: AgentSessionLogEntryDto[] }
  /** One durable row, in delivery order. */
  | { kind: 'confirmed'; row: AgentSessionLogEntryDto }
  /**
   * An action this client issued that the log has not confirmed. `action`
   * is the control endpoint's request body, `actionId` the id it will be
   * accepted under, `userId` the caller so the folded message is attributed
   * exactly as the confirmed row will be.
   */
  | {
      kind: 'speculated';
      actionId: string;
      action: AgentAction;
      userId?: string;
    }
  /** An action the server will never log: failed POST, refused control. */
  | { kind: 'retracted'; actionId: string };

/** Fold inputs into a session's machine, in order. */
export interface FoldPushRequest {
  id: number;
  kind: 'push';
  sessionId: string;
  inputs: FoldInput[];
}

/**
 * Read a session's machine without folding anything: what a surface joining
 * an already-followed session asks, instead of refetching a log the machine
 * is ahead of.
 */
export interface FoldReadRequest {
  id: number;
  kind: 'read';
  sessionId: string;
}

/** Drop a session's machine and its wasm memory. */
export interface FoldCloseRequest {
  id: number;
  kind: 'close';
  sessionId: string;
}

export type FoldRequest = FoldPushRequest | FoldReadRequest | FoldCloseRequest;

/** What the worker sends back, one per request. */
export type FoldResponse =
  | { id: number; ok: true; kind: 'push'; changes: FoldedStreamEvent[] }
  | {
      id: number;
      ok: true;
      kind: 'read';
      messages: FoldedMessage[];
      metadata: SessionMetadata;
    }
  | { id: number; ok: true; kind: 'close' }
  | { id: number; ok: false; error: string };
