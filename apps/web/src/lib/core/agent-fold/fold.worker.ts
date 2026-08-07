/// <reference lib="webworker" />

/**
 * Folds agent-session logs off the main thread.
 *
 * The fold is fast — single-digit milliseconds for a session of several
 * thousand frames — but the logs are not small, and instantiating the wasm
 * module is not free. Doing both here keeps the longest channel load off the
 * thread that has to stay responsive, and means the module is compiled once
 * for the tab rather than once per channel.
 */

import type { FoldRequest, FoldResponse } from './protocol';
import { loadAgentFoldWasm } from './wasm-module';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<FoldRequest>) => {
  const { id, sessionId, entries } = event.data;

  void (async () => {
    let response: FoldResponse;
    try {
      const wasm = await loadAgentFoldWasm();
      response = {
        id,
        ok: true,
        messages: wasm.fold_session(sessionId, entries),
      };
    } catch (error) {
      // Includes the wasm module failing to load at all, which is why the
      // caller treats a failure as "this channel folds to nothing" rather
      // than retrying: a missing module will not appear on a second try.
      response = {
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    scope.postMessage(response);
  })();
});
