/**
 * Typed surface of the generated wasm package (`agent_fold`), loaded
 * dynamically so the repo type-checks without the generated artifacts.
 *
 * Build the package with:
 *   just build-agent-fold-wasm
 * which runs wasm-pack over crates/agent_fold into
 * src/lib/core/agent-fold/wasm/ (gitignored).
 */

import type {
  FoldedMessage,
  FoldedStreamEvent,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';

/**
 * One live session's fold, held open between frames.
 *
 * Mirrors `agent_fold::inbound::wasm::FoldStream`. Frames must be handed over
 * in log order, and one machine serves a session for its whole life — the
 * fetched log and the streamed frames after it go into the same instance, so
 * that a channel opened mid-session continues the fold rather than starting a
 * second one beside it.
 */
export interface FoldStream {
  /**
   * Fold a run of frames and answer with every message derived so far.
   *
   * The catch-up path. Not a loop of {@link push}: a push serializes the
   * message it changed, and a session's frames change the same agent message
   * over and over, so replaying a fetched log one frame at a time would
   * serialize thousands of whole messages to produce a handful.
   */
  extend: (entries: AgentSessionLogEntryDto[]) => FoldedMessage[];
  /**
   * Fold one more frame, reporting the changes it implied.
   *
   * Empty for the frames that change nothing renderable — handshakes, token
   * accounting — which is most of them.
   */
  push: (entry: AgentSessionLogEntryDto) => FoldedStreamEvent[];
  /** Every message folded so far, oldest first. */
  messages: () => FoldedMessage[];
  /**
   * The session metadata as it now stands — what the latest
   * `{kind: "metadata"}` event carried, for a caller that caught up with
   * {@link extend} and saw no events.
   */
  metadata: () => SessionMetadata;
  /** Releases the machine's wasm memory. */
  free: () => void;
}

interface AgentFoldWasmModule {
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
  /**
   * Fold a session's log into the messages a channel renders.
   *
   * Throws a string when the input cannot be read — a session id that is not
   * a UUID, or entries that are not log frames. The fold itself is total, so
   * a half-finished or unrecognized frame yields a partially-known message
   * rather than an error.
   */
  fold_session: (
    sessionId: string,
    entries: AgentSessionLogEntryDto[]
  ) => FoldedMessage[];
  /** Opens a fold for one session. Throws when the id is not a UUID. */
  FoldStream: new (
    sessionId: string
  ) => FoldStream;
}

let modulePromise: Promise<AgentFoldWasmModule> | undefined;

/** Loads and initializes the wasm module exactly once per worker context. */
export function loadAgentFoldWasm(): Promise<AgentFoldWasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const url = new URL('./wasm/agent_fold.js', import.meta.url).href;
      const mod = (await import(/* @vite-ignore */ url)) as AgentFoldWasmModule;
      // Resolve the wasm binary explicitly: vite copies the generated JS as an
      // opaque asset, so its internal relative `agent_fold_bg.wasm` URL would
      // 404 in production. This `new URL` pattern is statically analyzable, so
      // vite emits the binary as an asset and rewrites it.
      const wasmUrl = new URL('./wasm/agent_fold_bg.wasm', import.meta.url);
      await mod.default({ module_or_path: wasmUrl });
      return mod;
    })();
  }
  return modulePromise;
}
