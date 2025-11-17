import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { Websocket } from '../core/websocket';
import { WebsocketConnectionState } from '../core/websocket-connection-state';
import { WebsocketEvent } from '../core/websocket-event';

/**
 * Creates a reactive signal that tracks the connection state of a websocket.
 *
 * @param ws The websocket to track the connection state of.
 * @returns A reactive signal that tracks the connection state of the websocket.
 */
export function createWebsocketStateSignal(
  ws: Websocket<any, any>
): Accessor<WebsocketConnectionState> {
  const [state, setState] = createSignal(ws.connectionState);

  const EVENT_HANDLERS: Record<
    | WebsocketEvent.open
    | WebsocketEvent.close
    | WebsocketEvent.error
    | WebsocketEvent.reconnect
    | WebsocketEvent.retry,
    () => void
  > = {
    [WebsocketEvent.open]: () => {
      setState(WebsocketConnectionState.Open);
    },
    [WebsocketEvent.close]: () => {
      setState(WebsocketConnectionState.Closed);
    },
    [WebsocketEvent.error]: () => {
      setState(WebsocketConnectionState.Closing);
    },
    [WebsocketEvent.reconnect]: () => {
      setState(WebsocketConnectionState.Reconnecting);
    },
    [WebsocketEvent.retry]: () => {
      setState(WebsocketConnectionState.Reconnecting);
    },
  };

  ws.addEventListener(WebsocketEvent.open, EVENT_HANDLERS[WebsocketEvent.open]);
  ws.addEventListener(
    WebsocketEvent.close,
    EVENT_HANDLERS[WebsocketEvent.close]
  );
  ws.addEventListener(
    WebsocketEvent.error,
    EVENT_HANDLERS[WebsocketEvent.error]
  );
  ws.addEventListener(
    WebsocketEvent.reconnect,
    EVENT_HANDLERS[WebsocketEvent.reconnect]
  );
  ws.addEventListener(
    WebsocketEvent.retry,
    EVENT_HANDLERS[WebsocketEvent.retry]
  );

  onCleanup(() => {
    ws.removeEventListener(
      WebsocketEvent.open,
      EVENT_HANDLERS[WebsocketEvent.open]
    );
    ws.removeEventListener(
      WebsocketEvent.close,
      EVENT_HANDLERS[WebsocketEvent.close]
    );
    ws.removeEventListener(
      WebsocketEvent.error,
      EVENT_HANDLERS[WebsocketEvent.error]
    );
    ws.removeEventListener(
      WebsocketEvent.reconnect,
      EVENT_HANDLERS[WebsocketEvent.reconnect]
    );
    ws.removeEventListener(
      WebsocketEvent.retry,
      EVENT_HANDLERS[WebsocketEvent.retry]
    );
  });

  return state;
}
