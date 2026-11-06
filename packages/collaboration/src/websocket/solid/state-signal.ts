import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { Websocket } from '../core/websocket';
import { WebsocketConnectionState } from '../core/websocket-connection-state';
import { WebsocketEvent } from '../core/websocket-event';

/** The slice of {@link Websocket} the signal needs — satisfied by the
 * concrete websocket and by virtual sockets (e.g. the gateway sync
 * transport's per-document sockets). */
export type StateSignalSocket = Pick<
  Websocket<any, any>,
  'connectionState' | 'addEventListener' | 'removeEventListener'
>;

/**
 * Creates a reactive signal that tracks the connection state of a websocket.
 *
 * @param ws The websocket to track the connection state of.
 * @returns A reactive signal that tracks the connection state of the websocket.
 */
export function createWebsocketStateSignal(
  ws: StateSignalSocket
): Accessor<WebsocketConnectionState> {
  const [state, setState] = createSignal(ws.connectionState);

  const EVENT_HANDLERS: Record<
    | WebsocketEvent.Open
    | WebsocketEvent.Close
    | WebsocketEvent.Error
    | WebsocketEvent.Reconnect
    | WebsocketEvent.retry,
    () => void
  > = {
    [WebsocketEvent.Open]: () => {
      setState(WebsocketConnectionState.Open);
    },
    [WebsocketEvent.Close]: () => {
      setState(WebsocketConnectionState.Closed);
    },
    [WebsocketEvent.Error]: () => {
      setState(WebsocketConnectionState.Closing);
    },
    [WebsocketEvent.Reconnect]: () => {
      setState(WebsocketConnectionState.Reconnecting);
    },
    [WebsocketEvent.retry]: () => {
      setState(WebsocketConnectionState.Reconnecting);
    },
  };

  ws.addEventListener(WebsocketEvent.Open, EVENT_HANDLERS[WebsocketEvent.Open]);
  ws.addEventListener(
    WebsocketEvent.Close,
    EVENT_HANDLERS[WebsocketEvent.Close]
  );
  ws.addEventListener(
    WebsocketEvent.Error,
    EVENT_HANDLERS[WebsocketEvent.Error]
  );
  ws.addEventListener(
    WebsocketEvent.Reconnect,
    EVENT_HANDLERS[WebsocketEvent.Reconnect]
  );
  ws.addEventListener(
    WebsocketEvent.retry,
    EVENT_HANDLERS[WebsocketEvent.retry]
  );

  onCleanup(() => {
    ws.removeEventListener(
      WebsocketEvent.Open,
      EVENT_HANDLERS[WebsocketEvent.Open]
    );
    ws.removeEventListener(
      WebsocketEvent.Close,
      EVENT_HANDLERS[WebsocketEvent.Close]
    );
    ws.removeEventListener(
      WebsocketEvent.Error,
      EVENT_HANDLERS[WebsocketEvent.Error]
    );
    ws.removeEventListener(
      WebsocketEvent.Reconnect,
      EVENT_HANDLERS[WebsocketEvent.Reconnect]
    );
    ws.removeEventListener(
      WebsocketEvent.retry,
      EVENT_HANDLERS[WebsocketEvent.retry]
    );
  });

  return state;
}
