import type { Websocket } from './websocket';
import type { WebsocketData } from './websocket-serializer';

/**
 * Events that can be fired by the websocket.
 */
export enum WebsocketEvent {
  /** Fired when the connection is opened. */
  open = 'open',

  /** Fired when the connection is closed. */
  close = 'close',

  /** Fired when the connection has been closed because of an error, such as when some data couldn't be sent. */
  error = 'error',

  /** Fired when a message is received. */
  message = 'message',

  /** Fired when the websocket tries to reconnect after a connection loss. */
  retry = 'retry',

  /** Fired when the websocket successfully reconnects after a connection loss. */
  reconnect = 'reconnect',

  /** Fired when a heartbeat is successfully sent. */
  heartbeatSent = 'heartbeatSent',

  /** Fired when a heartbeat is received. */
  heartbeatReceived = 'heartbeatReceived',

  /** Fired when a heartbeat is missed. */
  heartbeatMissed = 'heartbeatMissed',
}

/***
 * Details/properties of a retry-event.
 */
export type RetryEventDetail = {
  /** Number of retries that have been made since the connection was lost. */
  readonly retries: number;

  /** Time (ms) waited since the last connection-retry. */
  readonly backoff: number;

  /** Timestamp of when the connection was lost or undefined if the connection has never been established. */
  readonly lastConnection: Date | undefined;

  /** The url that was used to connect to. */
  readonly url: string;
};

/**
 * Properties of a reconnect-event.
 */
export type ReconnectEventDetail = Omit<RetryEventDetail, 'backoff'>;

/**
 * Properties of a heartbeat-sent-event or a heartbeat-received-event.
 */
export type HeartbeatEventDetail = {
  /** The message that was sent or received. */
  readonly message: string;
  /** The timestamp of when the message was sent or received. */
  readonly timestamp: number;
};

/**
 * Properties of a heartbeat-missed-event.
 */
export type HeartbeatMissedEventDetail = {
  /** number of missed heartbeats */
  readonly missedHeartbeats: number;

  /** whether the websocket will reconnect due to missed heartbeats */
  readonly willReconnect: boolean;
};

/**
 * Maps websocket events to their corresponding event.
 */
export type WebsocketEventMap<Receive = WebsocketData> = {
  [WebsocketEvent.open]: Event;
  [WebsocketEvent.close]: CloseEvent;
  [WebsocketEvent.error]: Event;
  [WebsocketEvent.message]: MessageEvent<Receive>;
  [WebsocketEvent.retry]: CustomEvent<RetryEventDetail>;
  [WebsocketEvent.reconnect]: CustomEvent<ReconnectEventDetail>;
  [WebsocketEvent.heartbeatSent]: CustomEvent<HeartbeatEventDetail>;
  [WebsocketEvent.heartbeatReceived]: CustomEvent<HeartbeatEventDetail>;
  [WebsocketEvent.heartbeatMissed]: CustomEvent<HeartbeatMissedEventDetail>;
};

/**
 * Discriminated union of all websocket events
 */
export type WebsocketEventUnion<Receive = WebsocketData> =
  | { type: WebsocketEvent.open; event: Event }
  | { type: WebsocketEvent.close; event: CloseEvent }
  | { type: WebsocketEvent.error; event: Event }
  | { type: WebsocketEvent.message; event: MessageEvent<Receive> }
  | { type: WebsocketEvent.retry; event: CustomEvent<RetryEventDetail> }
  | { type: WebsocketEvent.reconnect; event: CustomEvent<ReconnectEventDetail> }
  | {
      type: WebsocketEvent.heartbeatSent;
      event: CustomEvent<HeartbeatEventDetail>;
    }
  | {
      type: WebsocketEvent.heartbeatReceived;
      event: CustomEvent<HeartbeatEventDetail>;
    }
  | {
      type: WebsocketEvent.heartbeatMissed;
      event: CustomEvent<HeartbeatMissedEventDetail>;
    };

/**
 * Listener for websocket events.
 * */
export type WebsocketEventListener<
  K extends WebsocketEvent,
  Send = WebsocketData,
  Receive = WebsocketData,
> = (instance: Websocket<Send, Receive>, ev: WebsocketEventMap<Receive>[K]) => unknown;

export type WebsocketEventListenerParams<
  K extends WebsocketEvent,
  Send = WebsocketData,
  Receive = WebsocketData,
> = Parameters<WebsocketEventListener<K, Send, Receive>>;

/**
 * Options for websocket events.
 */
export type WebsocketEventListenerOptions = EventListenerOptions &
  AddEventListenerOptions;

/**
 * Listener for websocket events with options.
 */
export type WebsocketEventListenerWithOptions<
  K extends WebsocketEvent,
  Send = WebsocketData,
  Receive = WebsocketData,
> = {
  readonly listener: WebsocketEventListener<K, Send, Receive>;
  readonly options?: WebsocketEventListenerOptions;
};

/**
 * Maps websocket events to their corresponding event-listeners.
 */
export type WebsocketEventListeners<
  Send = WebsocketData,
  Receive = WebsocketData,
> = {
  [K in WebsocketEvent]: WebsocketEventListenerWithOptions<K, Send, Receive>[];
};
