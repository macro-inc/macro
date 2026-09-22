/// <reference lib="webworker" />

/**
 * Folds agent-session logs off the main thread.
 *
 * The fold is fast — single-digit milliseconds for a session of several
 * thousand frames — but the logs are not small, and instantiating the wasm
 * module is not free. Doing both here keeps the longest channel load off the
 * thread that has to stay responsive, and means the module is compiled once
 * for the tab rather than once per channel.
 *
 * It is also where a live session's fold *lives*: one machine per session id,
 * held across requests. That is the whole reason requests are served strictly
 * one at a time below — a machine is a sequence, and answering two `push`es
 * concurrently would fold inputs out of order.
 */

import { match } from 'ts-pattern';
import type { FoldRequest, FoldResponse } from './protocol';
import { type FoldStream, loadAgentFoldWasm } from './wasm-module';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** The open machines, one per live session. */
const streams = new Map<string, FoldStream>();

/**
 * The tail of the request chain.
 *
 * Handling a request awaits the wasm module, so without this each request
 * would suspend and resume independently and two inputs could reach a machine
 * in the wrong order. Chaining every request onto the previous one makes the
 * worker serve them in the order they were posted, which is the order the
 * caller folded them in.
 */
let queue: Promise<void> = Promise.resolve();

async function serve(request: FoldRequest): Promise<FoldResponse> {
  const wasm = await loadAgentFoldWasm();

  return match(request)
    .with({ kind: 'push' }, ({ id, kind, sessionId, inputs }) => {
      // Created on first use. The machine itself refuses anything before a
      // snapshot, so a caller that lost its machine (a worker restart) hears
      // about it on its next live input rather than folding from the middle
      // of a log.
      let stream = streams.get(sessionId);
      if (!stream) {
        stream = new wasm.FoldStream(sessionId);
        streams.set(sessionId, stream);
      }
      const changes = stream.push(inputs);
      return { id, kind, ok: true as const, changes };
    })
    .with({ kind: 'read' }, ({ id, kind, sessionId }) => {
      const stream = streams.get(sessionId);
      if (!stream) throw new Error(`no open fold for session ${sessionId}`);
      return {
        id,
        kind,
        ok: true as const,
        messages: stream.messages(),
        metadata: stream.metadata(),
      };
    })
    .with({ kind: 'close' }, ({ id, kind, sessionId }) => {
      streams.get(sessionId)?.free();
      streams.delete(sessionId);
      return { id, kind, ok: true as const };
    })
    .exhaustive();
}

scope.addEventListener('message', (event: MessageEvent<FoldRequest>) => {
  const request = event.data;

  queue = queue.then(async () => {
    let response: FoldResponse;
    try {
      response = await serve(request);
    } catch (error) {
      // Includes the wasm module failing to load at all, which is why the
      // caller treats a failure as "this session folds to nothing" rather
      // than retrying: a missing module will not appear on a second try.
      response = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    scope.postMessage(response);
  });
});
