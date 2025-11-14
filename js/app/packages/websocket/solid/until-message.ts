import {
  type Websocket,
  WebsocketEvent,
  type WebsocketEventMap,
} from '@websocket';
import type { WebsocketData } from '@websocket/websocket-serializer';

export function untilMessage<Receive extends WebsocketData>(
  ws: Websocket<any, Receive>,
  predicate: (data: Receive) => boolean
): Promise<Receive> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      ws.removeEventListener(WebsocketEvent.message, handler);
      ws.removeEventListener(WebsocketEvent.close, closeHandler);
    };

    const handler = (
      _ws: Websocket<any, Receive>,
      e: WebsocketEventMap[WebsocketEvent.message]
    ) => {
      const data = e.data;
      if (predicate(data)) {
        cleanup();
        resolve(data);
      }
    };

    const closeHandler = () => {
      cleanup();
      reject(new Error('WebSocket closed before message received'));
    };

    ws.addEventListener(WebsocketEvent.message, handler);
    ws.addEventListener(WebsocketEvent.close, closeHandler);
  });
}
