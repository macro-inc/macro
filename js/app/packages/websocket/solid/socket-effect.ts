import type { ObjectLike } from '@core/util/maybeResult';
import type { Websocket } from '@websocket/websocket';
import { WebsocketEvent } from '@websocket/websocket-event';
import { getOwner, onCleanup } from 'solid-js';

export function createWebsocketEventEffect<
  EventType extends string,
  Receive extends ObjectLike & { type: EventType },
>(
  ws: Websocket<any, any>,
  eventType: EventType,
  callback: (data: Receive) => void
) {
  const messageHandler = (_i: Websocket, e: MessageEvent) => {
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

export function createSocketEffect<Receive>(
  ws: Websocket<any, Receive>,
  callback: (data: Receive) => void
) {
  const messageHandler = (instance: Websocket, e: MessageEvent<Receive>) => {
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

export function createWebsocketEventEffects<
  EventHandlers extends Record<string, (data: any) => void>,
>(ws: Websocket<any, any>, handlers: EventHandlers) {
  Object.entries(handlers).forEach(([eventType, handler]) => {
    createWebsocketEventEffect(ws, eventType, handler);
  });
}

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
