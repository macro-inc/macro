import {
  type Websocket,
  WebsocketEvent,
  type WebsocketEventMap,
} from '@websocket';

export async function untilEvent<Send, Receive, K extends WebsocketEvent>(
  ws: Websocket<Send, Receive>,
  event: K
) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      ws.removeEventListener(event, handler);
      ws.removeEventListener(WebsocketEvent.Close, closeHandler);
    };

    const handler = (
      _ws: Websocket<Send, Receive>,
      e: WebsocketEventMap<Receive>[typeof event]
    ) => {
      cleanup();
      resolve(e);
    };

    const closeHandler = () => {
      cleanup();
      reject(new Error('WebSocket closed before event'));
    };

    ws.addEventListener(event, handler);
    ws.addEventListener(WebsocketEvent.Close, closeHandler);
  });
}
