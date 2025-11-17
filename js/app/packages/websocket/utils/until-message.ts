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
      ws.removeEventListener(WebsocketEvent.Message, handler);
      ws.removeEventListener(WebsocketEvent.Close, closeHandler);
    };

    const handler = (
      _ws: Websocket<Send, Receive>,
      e: WebsocketEventMap<Receive>[WebsocketEvent.Message]
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

    ws.addEventListener(WebsocketEvent.Message, handler);
    ws.addEventListener(WebsocketEvent.Close, closeHandler);
  });
}
