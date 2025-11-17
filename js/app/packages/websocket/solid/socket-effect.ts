import type { ObjectLike } from '@core/util/maybeResult';
import { getOwner, onCleanup } from 'solid-js';
import type { Websocket } from '../core/websocket';
import { WebsocketEvent } from '../core/websocket-event';

/**
 * Creates a reactive effect that listens for a specific websocket event and triggers a callback when the event is received.
 *
 * @param ws The websocket to listen for the event on, that has a json serializable data type.
 * @param eventType The type of the event to listen for.
 * @param callback The callback to trigger when the event is received.
 */
export function createWebsocketEventEffect<
  EventType extends string,
  Receive extends ObjectLike & { type: EventType },
>(
  ws: Websocket<any, Receive>,
  eventType: EventType,
  callback: (data: Receive) => void
) {
  const messageHandler = (
    _i: Websocket<any, Receive>,
    e: MessageEvent<Receive>
  ) => {
    const data = e.data;

    if (
      data &&
      typeof data === 'object' &&
      'type' in data &&
      data.type === eventType
    ) {
      callback(data as Receive);
    }
  };

  ws.addEventListener(WebsocketEvent.message, messageHandler);

  if (getOwner()) {
    onCleanup(() => {
      ws.removeEventListener(WebsocketEvent.message, messageHandler);
    });
  }
}

/**
 * Creates a reactive effect that listens for all websocket messages and triggers a callback when a message is received.
 *
 * @param ws The websocket to listen for messages on.
 * @param callback The callback to trigger when a message is received.
 */
export function createSocketEffect<Send, Receive>(
  ws: Websocket<Send, Receive>,
  callback: (data: Receive) => void
) {
  const messageHandler = (
    _: Websocket<Send, Receive>,
    e: MessageEvent<Receive>
  ) => {
    const data = e.data;
    callback(data);
  };

  ws.addEventListener(WebsocketEvent.message, messageHandler);

  const dispose = () => {
    ws.removeEventListener(WebsocketEvent.message, messageHandler);
  };

  if (getOwner()) {
    onCleanup(() => {
      dispose();
    });
  }

  return dispose;
}

/**
 * Creates a reactive effect that triggers when a websocket reconnects successfully.
 *
 * @param ws The websocket to listen for reconnects on.
 * @param callback The callback to trigger when the websocket reconnects successfully.
 */
export function createReconnectEffect(
  ws: Websocket<any, any>,
  callback: () => void
) {
  const reconnectingHandler = () => {
    callback();
  };

  ws.addEventListener(WebsocketEvent.reconnect, reconnectingHandler);

  if (getOwner()) {
    onCleanup(() => {
      ws.removeEventListener(WebsocketEvent.reconnect, reconnectingHandler);
    });
  }
}
