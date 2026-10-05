import { match } from 'ts-pattern';
import {
  ArchiveError,
  DEFAULT_ARCHIVE_LIMITS,
} from '../../../features/slack-import/core/export';
import type {
  ArchiveWorkerPort,
  ArchiveWorkerRequest,
} from '../../../features/slack-import/core/worker-protocol';
import { ArchiveReader } from './archive-reader';
import { deleteMessageStore, MessageStore } from './message-store';
import { ndjsonParts } from './ndjson-parts';

type Session = {
  id: string;
  reader: ArchiveReader;
  abort: AbortController;
  phase: 'discovering' | 'discovered' | 'reading';
  sequence: number;
  selectedBytes: number;
  acknowledge?: () => void;
};

/** Kept injectable so worker lifetime/cancellation can be tested without app services. */
export function installArchiveWorker(port: ArchiveWorkerPort): void {
  let session: Session | undefined;

  function reportError(id: string, error: unknown): void {
    const failure =
      error instanceof ArchiveError ? error : new ArchiveError('invalid_zip');
    if (failure.code === 'cancelled')
      port.postMessage({ type: 'cancelled', sessionId: id });
    else
      port.postMessage({
        type: 'error',
        sessionId: id,
        code: failure.code,
        message: failure.message,
      });
  }

  async function discover(
    request: Extract<ArchiveWorkerRequest, { type: 'discover' }>
  ): Promise<void> {
    if (session) {
      reportError(request.sessionId, new ArchiveError('invalid_state'));
      return;
    }
    try {
      const current: Session = {
        id: request.sessionId,
        reader: new ArchiveReader(request.archive, request.limits),
        abort: new AbortController(),
        phase: 'discovering',
        sequence: 0,
        selectedBytes:
          request.limits?.selectedBytes ?? DEFAULT_ARCHIVE_LIMITS.selectedBytes,
      };
      session = current;
      const discovery = await current.reader.discover(current.abort.signal);
      current.selectedBytes -= new TextEncoder().encode(
        JSON.stringify(discovery.users)
      ).length;
      if (current.selectedBytes < 0) throw new ArchiveError('selected_limit');
      current.phase = 'discovered';
      port.postMessage({
        type: 'discovered',
        sessionId: current.id,
        discovery,
      });
    } catch (error) {
      session = undefined;
      reportError(request.sessionId, error);
    }
  }

  async function readHistory(
    request: Extract<ArchiveWorkerRequest, { type: 'read_history' }>
  ): Promise<void> {
    if (
      !session ||
      session.id !== request.sessionId ||
      session.phase !== 'discovered'
    ) {
      reportError(request.sessionId, new ArchiveError('invalid_state'));
      return;
    }
    const current = session;
    current.phase = 'reading';
    let store: MessageStore | undefined;
    let failure: unknown;
    try {
      store = await MessageStore.open(current.id, current.selectedBytes);
      for await (const day of current.reader.readHistory(
        request.selectedIds,
        request.includeMessageHistory,
        current.abort.signal
      )) {
        await store.stage(
          day.slackChannelId,
          day.records,
          current.abort.signal
        );
      }
      for (const id of [...request.selectedIds].sort()) {
        for await (const output of ndjsonParts(
          id,
          store.ordered(id, current.abort.signal),
          request.partLimits,
          current.abort.signal
        )) {
          if (output.type === 'seal') {
            port.postMessage({ ...output, sessionId: current.id });
            continue;
          }
          await new Promise<void>((resolve, reject) => {
            function abort(): void {
              current.acknowledge = undefined;
              reject(new ArchiveError('cancelled'));
            }
            if (current.abort.signal.aborted) {
              abort();
              return;
            }
            current.abort.signal.addEventListener('abort', abort, {
              once: true,
            });
            current.acknowledge = () => {
              current.abort.signal.removeEventListener('abort', abort);
              current.acknowledge = undefined;
              resolve();
            };
            port.postMessage(
              {
                ...output,
                sessionId: current.id,
                sequence: current.sequence,
              },
              [output.bytes.buffer]
            );
          });
          current.sequence++;
        }
      }
    } catch (error) {
      failure = error;
    } finally {
      try {
        if (store) await store.dispose();
        else await deleteMessageStore(current.id);
      } catch (error) {
        failure ??= error;
      }
      session = undefined;
    }
    if (current.abort.signal.aborted) failure = new ArchiveError('cancelled');
    if (failure) reportError(current.id, failure);
    else port.postMessage({ type: 'complete', sessionId: current.id });
  }

  port.onmessage = ({ data }) => {
    match(data)
      .with({ type: 'discover' }, (request) => {
        void discover(request);
      })
      .with({ type: 'read_history' }, (request) => {
        void readHistory(request);
      })
      .with({ type: 'ack_part' }, (request) => {
        if (
          session?.id === request.sessionId &&
          session.sequence === request.sequence
        )
          session.acknowledge?.();
      })
      .with({ type: 'cancel' }, (request) => {
        if (session?.id !== request.sessionId) return;
        session.abort.abort();
        if (session.phase === 'discovered') {
          session = undefined;
          port.postMessage({ type: 'cancelled', sessionId: request.sessionId });
        }
      })
      .exhaustive();
  };
}

// Worker entry point only: importing in a browser window does not install a handler.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  installArchiveWorker(self);
}
