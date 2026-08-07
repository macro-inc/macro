/**
 * Typed surface of the generated wasm package (`agent_fold`), loaded
 * dynamically so the repo type-checks without the generated artifacts.
 *
 * Build the package with:
 *   just build-agent-fold-wasm
 * which runs wasm-pack over crates/agent_fold into
 * src/lib/core/agent-fold/wasm/ (gitignored).
 */

import type { AgentSessionLogEntryDto } from '@service-storage/generated/schemas/agentSessionLogEntryDto';
import type { FoldedMessage } from './types';

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
