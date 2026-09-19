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

interface AgentFoldWasmModule {
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
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
