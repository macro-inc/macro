import {
  type Websocket,
  WebsocketEvent,
  type WebsocketEventMap,
} from '@websocket';

/**
 * Waits for a message to be received from the websocket.
 *
 * @param ws The websocket to wait for a message on.
 * @param predicate A predicate function that returns true if the message should be considered a match.
 * @returns A promise that resolves with the received message.
 */
export function untilMessage<Send, Receive>(
  ws: Websocket<Send, Receive>,
  predicate: (data: Receive) => boolean
): Promise<Receive> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      ws.removeEventListener(WebsocketEvent.message, handler);
      ws.removeEventListener(WebsocketEvent.close, closeHandler);
    };

    const handler = (
      _ws: Websocket<Send, Receive>,
      e: WebsocketEventMap<Receive>[WebsocketEvent.message]
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
