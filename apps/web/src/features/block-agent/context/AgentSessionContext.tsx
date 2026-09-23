/** Feature-owned session state and its provider/consumer boundary. */

import type { IssueResult } from '@core/agent-session/AgentSession';
import type {
  FoldedMessage,
  SessionMetadata,
  TurnState,
} from '@service-agent-fold/generated/types';
import type {
  AgentAction,
  AgentSessionResponse,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { QuoteInsert } from '../ui';
import type { QueueController } from './create-queue-controller';
import type { InteractionController } from './interaction';

export type AgentSessionState = {
  /** The viewer and display-name lookup supplied by production composition. */
  userId: Accessor<string | undefined>;
  displayName: (userId: string) => string;
  /**
   * The session this block shows, absent while a just-created one's `POST`
   * is still on the wire. See `pending-session.ts`.
   */
  sessionId: Accessor<string | undefined>;
  /** The session is still being created — everything else is empty because
   *  there is nothing to show yet, not because the load failed. */
  pending: Accessor<boolean>;
  startupError: Accessor<string | undefined>;
  /** Session metadata, absent until the load resolves. */
  session: Accessor<AgentSessionResponse | undefined>;
  /** The bot the session runs as, absent until the fold is acquired. */
  bot: Accessor<SessionBot | undefined>;
  /** The fold's session metadata (title, model, turn, …), followed live. */
  metadata: Accessor<SessionMetadata | undefined>;
  /** The folded transcript, ordered by turn, live-following the session. */
  messages: Accessor<FoldedMessage[]>;
  loadFailed: Accessor<boolean>;
  /** The load failed because the viewer is not a participant (401/403). */
  accessDenied: Accessor<boolean>;
  /**
   * Retry can re-run the failed load. False when the create itself failed —
   * there is no session to refetch, so offering Retry would do nothing.
   */
  loadRetryable: Accessor<boolean>;
  /** Re-runs a failed load. */
  retryLoad: () => void;
  /**
   * Where the newest turn stands, as the fold reports it: the block's one
   * answer to "what is the agent doing". Every consumer — composer, working
   * line, chrome — reads this discriminant, never the transcript's tail or
   * its own record of what it posted, so the block cannot disagree with
   * itself. `idle` until the fold has loaded.
   */
  turn: Accessor<TurnState>;
  /**
   * Do something to the agent: prompt, stop, change model. The fold shows
   * the action at once and the log settles it. `undefined` while the block
   * has no session to act on.
   */
  issue: (action: AgentAction) => Promise<IssueResult> | undefined;
  /**
   * Send the next queued message now: stop the running turn, and show the
   * queue head as sent under the id the server already holds it by. The
   * server dispatches it when the turn actually ends, and that row promotes
   * the speculation in place. No-op with nothing queued, and while the head
   * a previous call showed as sent is still unconfirmed (`turn` reads
   * `starting`): a stop posted then would end the turn already ending, and
   * the server would dispatch that head, not the next one.
   */
  sendNext: () => void;
  /** The live requests, and the action that answers each one. */
  interactions: InteractionController;
  /**
   * The session's server-side action queue: prompts sent mid-turn wait
   * there and dispatch one per turn end. The server is the only truth —
   * nothing is queued client-side.
   */
  queue: QueueController;
  /**
   * Quote selected transcript text into the composer as a referenced paste
   * chip. No-op until the composer editor has mounted.
   */
  quoteSelection: QuoteInsert;
  /** The composer registers its quote-insert handler here on mount. */
  registerQuoteInsert: (insert: QuoteInsert | undefined) => void;
};

export const AgentSessionContext = createContext<AgentSessionState>();

export function useAgentSession(): AgentSessionState {
  const ctx = useContext(AgentSessionContext);
  if (!ctx) {
    throw new Error(
      'useAgentSession must be used within <AgentSessionProvider />'
    );
  }
  return ctx;
}

/**
 * The session state when rendered inside a block, `undefined` when a
 * transcript is shown on its own (the debug gallery, replay fixtures). For
 * parts that act on the session when they can and read as inert otherwise.
 */
export function useOptionalAgentSession(): AgentSessionState | undefined {
  return useContext(AgentSessionContext);
}
