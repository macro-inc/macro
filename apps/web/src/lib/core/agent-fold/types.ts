/**
 * The renderable vocabulary an agent session's protocol log folds into.
 *
 * These used to be generated from the backend's OpenAPI schema, because the
 * fold ran on the server and the client was handed the result. It runs here
 * now — `agent_fold` compiled to WASM, over the raw log from
 * `getAgentChannelLog` — so the shapes are declared here instead, and the WASM
 * boundary is what has to match them.
 *
 * They mirror `agent_fold::domain::model` (Rust) one for one, in the wire form
 * the fold serializes to: enums are `kind`-tagged and fields are camelCase.
 * Keeping the names identical on both sides is the point — the fold's
 * vocabulary is the contract, not any particular transport.
 */

/** How far a tool call progressed. */
export type ToolStatus = 'pending' | 'running' | 'completed' | 'failed';

/** A file modification a tool reported. */
export interface FileDiff {
  /** The file that changed. */
  path: string;
  /** Prior contents, absent when the file is new. */
  oldText?: string | null;
  /** New contents. */
  newText: string;
}

/**
 * What a tool call actually did.
 *
 * Discriminated by what a reader needs in order to render it, not by ACP's
 * tool kind: a terminal wants command and output, an edit wants a diff, and
 * everything else falls back to its raw input.
 */
export type ToolDetail =
  | {
      kind: 'terminal';
      /** The command line, when the harness reported one. */
      command?: string | null;
      /** Captured output, ANSI escape sequences left in place. */
      output?: string | null;
      /** Process exit code, when the harness reported one. */
      exitCode?: number | null;
    }
  | { kind: 'edit'; diffs: FileDiff[] }
  | { kind: 'read'; paths: string[] }
  | {
      kind: 'other';
      /** ACP's tool kind, as its wire string. */
      acpKind: string;
      /** The tool's input, when reported. */
      input?: unknown;
    };

/** One choice offered for a permission request. */
export interface PermissionOption {
  /** The id to report back when this option is chosen. */
  id: string;
  /** Label to show. */
  name: string;
  /** ACP's option kind: `allow_once`, `reject_once`, `allow_always`, `reject_always`. */
  kind: string;
}

/** How a permission request resolved. */
export type PermissionOutcome =
  | { kind: 'selected'; optionId: string }
  | { kind: 'cancelled' };

/** A unit of renderable content. */
export type FoldedMessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | {
      kind: 'tool_use';
      /** The ACP `toolCallId`. */
      id: string;
      /** What to show as the tool's name. */
      label: string;
      status: ToolStatus;
      detail: ToolDetail;
    }
  | {
      kind: 'permission';
      /** The `toolCallId` permission was requested for. */
      toolCall: string;
      /** The choices offered, in the order ACP listed them. */
      options: PermissionOption[];
      /**
       * What the user chose. Absent while the request is outstanding, or when
       * the session ended before anyone answered.
       */
      outcome?: PermissionOutcome | null;
    };

/** Who produced a folded message. */
export type FoldedAuthor =
  | {
      kind: 'user';
      /** The user's macro id, absent when the prompt was unattributed. */
      userId?: string | null;
    }
  | { kind: 'agent' };

/** Why a turn stopped. */
export type StopReason =
  | { kind: 'end_turn' }
  | { kind: 'max_tokens' }
  | { kind: 'max_turn_requests' }
  | { kind: 'refusal' }
  | { kind: 'cancelled' }
  | { kind: 'other'; reason: string };

/**
 * One renderable message folded out of a session's protocol log.
 *
 * A turn produces at most two: the user's prompt and the agent's reply.
 */
export interface FoldedMessage {
  /**
   * The composite id the placeholder comms message for this folded message
   * carries in its `agent_session_message_id`:
   * `"{agentSessionId}:{turn}:{author}"`. Placeholder rows join to folded
   * messages by this, one to one.
   */
  agentSessionMessageId: string;
  /** The turn within the session, assigned in log order from zero. */
  turn: number;
  author: FoldedAuthor;
  /** Ordered renderable content. Never empty. */
  parts: FoldedMessagePart[];
  /**
   * How the turn ended, on the agent message that closed it. Absent while the
   * turn is in flight or when the session died without a response.
   */
  stop?: StopReason | null;
}

/**
 * What folding one more log frame changed.
 *
 * The message comes whole rather than as a delta, so either kind is applied
 * the same way — replace whatever is held under this `agentSessionMessageId`.
 * `kind` says whether a channel row for it exists yet: a turn has no
 * placeholder message until the fold first derives it, and `'new'` is the one
 * moment a client can synthesize one.
 */
export interface FoldedMessageChange {
  kind: 'new' | 'update';
  message: FoldedMessage;
}
