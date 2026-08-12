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
 * one at a time below — a machine is a sequence, and answering an `open` and
 * a `push` concurrently would fold frames out of order.
 */

import type { FoldedMessageChange } from '@service-agent-fold/generated/types';
import type { FoldRequest, FoldResponse } from './protocol';
import { type FoldStream, loadAgentFoldWasm } from './wasm-module';

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** The open machines, one per live session. */
const streams = new Map<string, FoldStream>();

/**
 * The tail of the request chain.
 *
 * Handling a request awaits the wasm module, so without this each request
 * would suspend and resume independently and two frames could reach a machine
 * in the wrong order. Chaining every request onto the previous one makes the
 * worker serve them in the order they were posted, which is the order the log
 * is in.
 */
let queue: Promise<void> = Promise.resolve();

async function serve(request: FoldRequest): Promise<FoldResponse> {
  const wasm = await loadAgentFoldWasm();
  const { id, kind, sessionId } = request;

  switch (kind) {
    case 'once':
      return {
        id,
        kind,
        ok: true,
        messages: wasm.fold_session(sessionId, request.entries),
      };

    case 'open': {
      // A fresh machine even when one is already open: the entries are a
      // snapshot from the top of the log, so replaying them into a machine
      // that has already seen them would duplicate every message.
      streams.get(sessionId)?.free();
      const stream = new wasm.FoldStream(sessionId);
      streams.set(sessionId, stream);
      return { id, kind, ok: true, messages: stream.extend(request.entries) };
    }

    case 'push': {
      const stream = streams.get(sessionId);
      // Refusing rather than opening one: a machine seeded from the middle of
      // a log folds a session that never happened, and a caller that has lost
      // its machine needs to refetch, not to keep pushing.
      if (!stream) throw new Error(`no open fold for session ${sessionId}`);
      const changes: FoldedMessageChange[] = [];
      for (const entry of request.entries) {
        const change = stream.push(entry);
        if (change) changes.push(change);
      }
      return { id, kind, ok: true, changes };
    }

    case 'messages': {
      const stream = streams.get(sessionId);
      if (!stream) throw new Error(`no open fold for session ${sessionId}`);
      return { id, kind, ok: true, messages: stream.messages() };
    }

    case 'close':
      streams.get(sessionId)?.free();
      streams.delete(sessionId);
      return { id, kind, ok: true };
  }
}

scope.addEventListener('message', (event: MessageEvent<FoldRequest>) => {
  const request = event.data;

  queue = queue.then(async () => {
    let response: FoldResponse;
    try {
      response = await serve(request);
    } catch (error) {
      // Includes the wasm module failing to load at all, which is why the
      // caller treats a failure as "this channel folds to nothing" rather
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
