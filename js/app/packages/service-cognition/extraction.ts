import { runWithOwner } from 'solid-js';
import type { ExtractionStatusEnum } from './generated/schemas';
import { createCognitionWebsocketEffect, ws } from './websocket';

type ResolveExtraction = {
  callback: (status: 'ok' | 'error') => void;
  clearTimeout: () => void;
};

const waiters: Map<string, ResolveExtraction> = new Map();

const ACCEPT_STATUSES: ExtractionStatusEnum['type'][] = [
  'complete',
  'insufficient',
  'empty',
];

// user will see an error if this times out
const MAX_WAIT_MS = 12000;

const createExtractionStatusEffects = (id: string) => {
  let dispose = () => {};

  // runWithOwner=null forces dispose to be called manually since we do not want a parent owner to be cleaned up early
  runWithOwner(null, () => {
    const disposeExtractionStatusUpdate = createCognitionWebsocketEffect(
      'extraction_status_update',
      (data) => {
        const waiter = waiters.get(id);
        if (!waiter) return;
        const status = ACCEPT_STATUSES.includes(data.status.type)
          ? 'ok'
          : 'error';
        waiter.callback(status);
        waiter.clearTimeout();
        waiters.delete(id);
        disposeExtractionStatusUpdate();
      }
    );

    const disposeExtractionStatusAck = createCognitionWebsocketEffect(
      'extraction_status_ack',
      (data) => {
        const waiter = waiters.get(id);
        if (!waiter) return;
        if (ACCEPT_STATUSES.includes(data.status.type)) {
          waiter.callback('ok');
          waiter.clearTimeout();
          waiters.delete(id);
          disposeExtractionStatusAck();
        }
      }
    );

    dispose = () => {
      disposeExtractionStatusUpdate();
      disposeExtractionStatusAck();
    };
  });

  return dispose;
};

export function waitExtractionStatus(id: string): Promise<'ok' | 'error'> {
  const disposeWebsocketEffects = createExtractionStatusEffects(id);

  ws.send({ type: 'extraction_status', attachment_id: id });

  return new Promise<'ok' | 'error'>((accept) => {
    // always run this after timeout
    setTimeout(() => {
      disposeWebsocketEffects();
      waiters.delete(id);
    }, MAX_WAIT_MS);

    const errorTimeout = setTimeout(() => {
      accept('error');
    }, MAX_WAIT_MS);

    waiters.set(id, {
      callback: accept,
      clearTimeout: () => clearTimeout(errorTimeout),
    });
  });
}
