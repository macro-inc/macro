import type { ToRuntimeMessage, ToServerMessage } from './protocol/generated';

/** A connection to the agent proxy carrying agent_runtime_protocol's typed
 * tagged messages. `connect` returns the production implementation; tests
 * implement this interface directly with a mock. Assign both handlers before
 * traffic flows. */
export interface Socket {
  /** Assigned by the consumer; fired once the socket is ready to send. */
  onOpen: () => void;
  /** Assigned by the consumer; fired for each decoded upstream message. */
  onMessage: (message: ToRuntimeMessage) => void;
  send(message: ToServerMessage): void;
  close(): void;
}

/** Dial the production `Socket`: one JSON `ToServerMessage`/`ToRuntimeMessage`
 * value per WebSocket frame, no envelope. No reconnect: a dropped socket
 * stays dropped. */
export function connect(url: string): Socket {
  const ws = new WebSocket(url);
  const socket: Socket = {
    onOpen: () => {},
    onMessage: () => {},
    send: (message) => ws.send(JSON.stringify(message)),
    close: () => ws.close(),
  };
  ws.addEventListener('open', () => socket.onOpen());
  ws.addEventListener('message', (event) => {
    let message: ToRuntimeMessage;
    try {
      const parsed: unknown = JSON.parse(String(event.data));
      if (!isRuntimeMessage(parsed)) throw new Error('invalid message');
      message = parsed;
    } catch {
      console.error('[socket] ignoring invalid upstream message', event.data);
      return;
    }
    socket.onMessage(message);
  });
  ws.addEventListener('close', (event) => {
    console.warn('[socket] closed', { code: event.code, reason: event.reason });
  });
  ws.addEventListener('error', (event) => {
    console.error('[socket] error', event);
  });
  return socket;
}

function isRuntimeMessage(value: unknown): value is ToRuntimeMessage {
  if (typeof value !== 'object' || value === null || !('type' in value))
    return false;
  if (value.type === 'acp') return true;
  return (
    value.type === 'reviewCapture' &&
    'request_id' in value &&
    typeof value.request_id === 'string' &&
    'workspace' in value &&
    typeof value.workspace === 'string' &&
    'base' in value &&
    (value.base === null || typeof value.base === 'string') &&
    'head' in value &&
    (value.head === null || typeof value.head === 'string')
  );
}
