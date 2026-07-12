import type { Websocket, WebsocketEvent, WebsocketEventMap } from '@websocket';

/**
 * Waits for a specific websocket event to be emitted.
 *
 * @param ws The websocket to wait for the event on.
 * @param event The event to wait for.
 * @returns A promise that resolves with the event data when the event is emitted.
 */
export async function untilEvent<Send, Receive, K extends WebsocketEvent>(
  ws: Websocket<Send, Receive>,
  event: K
) {
  return new Promise((resolve) => {
    const handler = (
      _ws: Websocket<Send, Receive>,
      e: WebsocketEventMap<Receive>[typeof event]
    ) => {
      ws.removeEventListener(event, handler);
      resolve(e);
    };

    ws.addEventListener(event, handler);
  });
}
