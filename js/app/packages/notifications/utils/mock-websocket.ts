import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import { createSignal } from 'solid-js';
import type { UnifiedNotification } from '../types';

export type MockWebsocketEmitter = (notification: UnifiedNotification) => void;

export function createMockWebsocket(): {
  ws: ConnectionGatewayWebsocket;
  emit: MockWebsocketEmitter;
} {
  const [listeners, setListeners] = createSignal<
    Array<(ws: any, event: MessageEvent) => void>
  >([]);

  const ws: ConnectionGatewayWebsocket = {
    send: () => {},
    addEventListener: (
      event: string,
      callback: (ws: any, e: MessageEvent) => void
    ) => {
      if (event === 'message') {
        setListeners((prev) => [...prev, callback]);
      }
    },
    removeEventListener: () => {},
    close: () => {},
    readyState: 1,
  } as any;

  const emit: MockWebsocketEmitter = (notification: UnifiedNotification) => {
    const messageData = {
      type: 'notification',
      data: JSON.stringify(notification),
    };

    // Create a proper MessageEvent
    const messageEvent = new MessageEvent('message', {
      data: messageData,
    });

    listeners().forEach((listener) => {
      listener(ws, messageEvent);
    });
  };

  return { ws, emit };
}
