/**
 * The `agent_fold` wasm module with its values typed by the specta types: the
 * generated declarations type them `any`.
 */

import agentFoldWasm from 'wasm:agent-fold';
import type {
  FoldedMessage,
  FoldedStreamEvent,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import type { FoldInput } from './protocol';

/**
 * One live session's fold, held open between inputs.
 *
 * Mirrors `agent_fold::inbound::wasm::FoldStream`. Inputs must be handed over
 * in order, a snapshot first, and one machine serves a session for its whole
 * life: the fetched log, the streamed rows after it, and this client's own
 * speculated actions all go into the same instance.
 */
export interface FoldStream {
  /**
   * Fold inputs in order, reporting the changes they implied. Empty for
   * inputs that change nothing renderable, which is most confirmed rows.
   * Throws a string when an input cannot be read or arrives before any
   * snapshot.
   */
  push: (inputs: FoldInput[]) => FoldedStreamEvent[];
  /**
   * Every message as the reader should see it, oldest first: the confirmed
   * conversation with this client's unconfirmed actions on top.
   */
  messages: () => FoldedMessage[];
  /** The session metadata as it now stands. */
  metadata: () => SessionMetadata;
  /** Releases the machine's wasm memory. */
  free: () => void;
}

export interface AgentFoldWasmModule {
  /** Opens a fold for one session. Throws when the id is not a UUID. */
  FoldStream: new (
    sessionId: string
  ) => FoldStream;
}

/** Loads the module once per worker; a failed load, such as an offline preload, is tried again. */
export async function loadAgentFoldWasm(): Promise<AgentFoldWasmModule> {
  // Checked against the generated declarations.
  const fold: AgentFoldWasmModule = await agentFoldWasm.load();
  return fold;
}
