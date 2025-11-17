import { match, P } from 'ts-pattern';
import { browserWebSocketFactory } from '../platform/minimal-websocket';
import type { Backoff } from './backoff/backoff';
import type { WebsocketBuffer } from './websocket-buffer';
import { WebsocketConnectionState } from './websocket-connection-state';
import {
  type HeartbeatEventDetail,
  type HeartbeatMissedEventDetail,
  type ReconnectEventDetail,
  type RetryEventDetail,
  WebsocketEvent,
  type WebsocketEventListener,
  type WebsocketEventListenerOptions,
  type WebsocketEventListeners,
  type WebsocketEventListenerWithOptions,
  type WebsocketEventMap,
  type WebsocketEventUnion,
} from './websocket-event';
import { isRequiredHeartbeatOptions } from './websocket-heartbeat-options';
import type { WebsocketOptions } from './websocket-options';
import {
  deserializeIfNeeded,
  serializeIfNeeded,
  type WebsocketData,
} from './websocket-serializer';
import {
  isString,
  resolveUrl,
  type UrlResolver,
} from './websocket-url-resolver';

/**
 * A websocket wrapper that can be configured to reconnect automatically and buffer messages when the websocket is not connected.
 */
export class Websocket<Send = WebsocketData, Receive = WebsocketData> {
  private _url: string; // the url to connect to
  private readonly _urlResolver: UrlResolver; // the url resolver to use
  private readonly _protocols?: string | string[]; // the protocols to use

  private _closedByUser: boolean = false; // whether the websocket was closed by the user
  private _lastConnection?: Date; // timestamp of the last connection
  private _underlyingWebsocket: WebSocket; // the underlying websocket, e.g. native browser websocket
  private retryTimeout?: ReturnType<typeof globalThis.setTimeout>; // timeout for the next retry, if any

  private heartbeatInterval?: ReturnType<typeof setInterval> | undefined; // interval for the heartbeat
  private heartbeatTimeout?: ReturnType<typeof setTimeout> | undefined; // timeout for the heartbeat
  private missedHeartbeats: number = 0; // number of missed heartbeats

  connectionState: WebsocketConnectionState =
    WebsocketConnectionState.Connecting;

  private _options: WebsocketOptions<Send, Receive> &
    Required<Pick<WebsocketOptions<Send, Receive>, 'listeners' | 'retry'>>; // options/config for the websocket

  /**
   * Creates a new websocket.
   *
   * @param url to connect to.
   * @param protocols optional protocols to use.
   * @param options optional options to use.
   */
  constructor(
    resolver: UrlResolver,
    protocols?: string | string[],
    options?: WebsocketOptions<Send, Receive>
  ) {
    this._protocols = protocols;

    // make a copy of the options to prevent the user from changing them
    this._options = {
      buffer: options?.buffer,
      retry: {
        maxRetries: options?.retry?.maxRetries,
        instantReconnect: options?.retry?.instantReconnect,
        backoff: options?.retry?.backoff,
      },
      heartbeat: {
        timeout: options?.heartbeat?.timeout,
        interval: options?.heartbeat?.interval,
        pingMessage: options?.heartbeat?.pingMessage,
        pongMessage: options?.heartbeat?.pongMessage,
        maxMissedHeartbeats: options?.heartbeat?.maxMissedHeartbeats,
      },
      listeners: {
        open: [...(options?.listeners?.open ?? [])],
        close: [...(options?.listeners?.close ?? [])],
        error: [...(options?.listeners?.error ?? [])],
        message: [...(options?.listeners?.message ?? [])],
        retry: [...(options?.listeners?.retry ?? [])],
        reconnect: [...(options?.listeners?.reconnect ?? [])],
        heartbeatSent: [...(options?.listeners?.heartbeatSent ?? [])],
        heartbeatReceived: [...(options?.listeners?.heartbeatReceived ?? [])],
        heartbeatMissed: [...(options?.listeners?.heartbeatMissed ?? [])],
      },
      binaryType: options?.binaryType,
      serializer: options?.serializer,
      factory: options?.factory,
    };

    this._urlResolver = resolver;

    if (isString(resolver)) {
      this._url = resolver;
    }

    this.tryConnect();
  }

  /**
   * Getter for the url.
   *
   * @return the url.
   */
  get url(): string {
    return this._url;
  }

  /**
   * Getter for the protocols.
   *
   * @return the protocols, or undefined if none were provided.
   */
  get protocols(): string | string[] | undefined {
    return this._protocols;
  }

  /**
   * Getter for the buffer.
   *
   * @return the buffer, or undefined if none was provided.
   */
  get buffer(): WebsocketBuffer<Send> | undefined {
    return this._options.buffer;
  }

  /**
   * Getter for the maxRetries.
   *
   * @return the maxRetries, or undefined if none was provided (no limit).
   */
  get maxRetries(): number | undefined {
    return this._options.retry.maxRetries;
  }

  /**
   * Getter for the instantReconnect.
   *
   * @return the instantReconnect, or undefined if none was provided.
   */
  get instantReconnect(): boolean | undefined {
    return this._options.retry.instantReconnect;
  }

  /**
   * Getter for the backoff.
   *
   * @return the backoff, or undefined if none was provided.
   */
  get backoff(): Backoff | undefined {
    return this._options.retry.backoff;
  }

  /**
   * Whether the websocket was closed by the user. A websocket is closed by the user by calling close().
   *
   * @return true if the websocket was closed by the user, false otherwise.
   */
  get closedByUser(): boolean {
    return this._closedByUser;
  }

  /**
   * Getter for the last 'open' event, e.g. the last time the websocket was connected.
   *
   * @return the last 'open' event, or undefined if the websocket was never connected.
   */
  get lastConnection(): Date | undefined {
    return this._lastConnection;
  }

  /**
   * Getter for the underlying websocket. This can be used to access the browser's native websocket directly.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   * @return the underlying websocket.
   */
  get underlyingWebsocket(): WebSocket {
    return this._underlyingWebsocket;
  }

  /**
   * Getter for the readyState of the underlying websocket.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/readyState
   * @return the readyState of the underlying websocket.
   */
  get readyState(): number {
    return this._underlyingWebsocket.readyState;
  }

  /**
   * Getter for the bufferedAmount of the underlying websocket.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/bufferedAmount
   * @return the bufferedAmount of the underlying websocket.
   */
  get bufferedAmount(): number {
    return this._underlyingWebsocket.bufferedAmount;
  }

  /**
   * Getter for the extensions of the underlying websocket.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/extensions
   * @return the extensions of the underlying websocket.
   */
  get extensions(): string {
    return this._underlyingWebsocket.extensions;
  }

  /**
   * Getter for the binaryType of the underlying websocket.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/binaryType
   * @return the binaryType of the underlying websocket.
   */
  get binaryType(): BinaryType {
    return this._underlyingWebsocket.binaryType;
  }

  /**
   * Setter for the binaryType of the underlying websocket.
   *
   * @param value to set, 'blob' or 'arraybuffer'.
   */
  set binaryType(value: BinaryType) {
    this._underlyingWebsocket.binaryType = value;
  }

  /**
   * Sends data over the websocket.
   *
   * If the websocket is not connected and a buffer was provided on creation, the data will be added to the buffer.
   * If no buffer was provided or the websocket was closed by the user, the data will be dropped.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/send
   * @param data to send.
   */
  public send(rawData: Send): void {
    if (this.closedByUser) return; // no-op if closed by user

    let data = serializeIfNeeded(rawData, this._options.serializer);

    if (
      this._underlyingWebsocket.readyState === this._underlyingWebsocket.OPEN
    ) {
      this._underlyingWebsocket.send(data); // websocket is connected, send data
    } else if (this.buffer !== undefined) {
      this.buffer.add(rawData); // websocket is not connected, add data to buffer
    }
  }

  /**
   * Close the websocket. No connection-retry will be attempted after this.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/close
   * @param code optional close code.
   * @param reason optional close reason.
   */
  public close(code?: number, reason?: string): void {
    this.cancelScheduledConnectionRetry(); // cancel any scheduled retries
    this._closedByUser = true; // mark websocket as closed by user
    this._underlyingWebsocket.close(code, reason); // close underlying websocket with provided code and reason
    this.stopHeartbeat();
  }

  /**
   * Adds an event listener for the given event-type.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
   * @param type of the event to add the listener for.
   * @param listener to add.
   * @param options to use when adding the listener.
   */
  public addEventListener<K extends WebsocketEvent>(
    type: K,
    listener: WebsocketEventListener<K, Send, Receive>,
    options?: WebsocketEventListenerOptions
  ): void {
    this._options.listeners[type].push({ listener, options }); // add listener to list of listeners
  }

  /**
   * Removes one or more event listener for the given event-type that match the given listener and options.
   *
   * @param type of the event to remove the listener for.
   * @param listener to remove.
   * @param options that were used when the listener was added.
   */
  public removeEventListener<K extends WebsocketEvent>(
    type: K,
    listener: WebsocketEventListener<K, Send, Receive>,
    options?: WebsocketEventListenerOptions
  ): void {
    const isListenerNotToBeRemoved = (
      l: WebsocketEventListenerWithOptions<K, Send, Receive>
    ) => l.listener !== listener || l.options !== options;

    (this._options.listeners[type] as WebsocketEventListenerWithOptions<
      K,
      Send,
      Receive
    >[]) = this._options.listeners[type].filter(isListenerNotToBeRemoved); // only keep listeners that are not to be removed
  }

  /**
   * Creates a new browser-native websocket and connects it to the given URL with the given protocols
   * and adds all event listeners to the browser-native websocket.
   *
   * @return the created browser-native websocket which is also stored in the '_underlyingWebsocket' property.
   */
  private async tryConnect(): Promise<WebSocket> {
    const url = await resolveUrl(this._urlResolver);
    this._url = url;
    const factory = this._options.factory ?? browserWebSocketFactory;
    const newSocket = factory(this.url, this.protocols); // create new browser-native websocket and add all event listeners
    this._underlyingWebsocket = newSocket;
    this._underlyingWebsocket.addEventListener(
      WebsocketEvent.open,
      this.handleOpenEvent
    );
    this._underlyingWebsocket.addEventListener(
      WebsocketEvent.close,
      this.handleCloseEvent
    );
    this._underlyingWebsocket.addEventListener(
      WebsocketEvent.error,
      this.handleErrorEvent
    );
    this._underlyingWebsocket.addEventListener(
      WebsocketEvent.message,
      this.handleMessageEvent
    );

    console.log("binary type", this._options.binaryType);
    if (this._options.binaryType !== undefined) {
      this._underlyingWebsocket.binaryType = this._options.binaryType;
    }

    return this._underlyingWebsocket;
  }

  /**
   * Removes all event listeners from the browser-native websocket and closes it.
   */
  private clearWebsocket() {
    this._underlyingWebsocket.removeEventListener(
      WebsocketEvent.open,
      this.handleOpenEvent
    );
    this._underlyingWebsocket.removeEventListener(
      WebsocketEvent.close,
      this.handleCloseEvent
    );
    this._underlyingWebsocket.removeEventListener(
      WebsocketEvent.error,
      this.handleErrorEvent
    );
    this._underlyingWebsocket.removeEventListener(
      WebsocketEvent.message,
      this.handleMessageEvent
    );
    this._underlyingWebsocket.close();
  }

  /**
   * Handles the 'open' event of the browser-native websocket.
   * @param event to handle.
   */
  private handleOpenEvent = (event: Event) =>
    this.handleEvent(WebsocketEvent.open, event);

  /**
   * Handles the 'error' event of the browser-native websocket.
   * @param event to handle.
   */
  private handleErrorEvent = (event: Event) =>
    this.handleEvent(WebsocketEvent.error, event);

  /**
   * Handles the 'close' event of the browser-native websocket.
   * @param event to handle.
   */
  private handleCloseEvent = (event: CloseEvent) =>
    this.handleEvent(WebsocketEvent.close, event);

  private handleHeartbeatReceived = (event: MessageEvent) => {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = undefined;
    }

    const receivedHeartbeatEvent = new CustomEvent<HeartbeatEventDetail>(
      WebsocketEvent.heartbeatReceived,
      {
        detail: {
          message: event.data,
          timestamp: Date.now(),
        },
      }
    );

    this.dispatchEvent(
      WebsocketEvent.heartbeatReceived,
      receivedHeartbeatEvent
    );
  };

  /**
   * Handles the 'message' event of the browser-native websocket.
   * @param event to handle.
   */
  private handleMessageEvent = (event: MessageEvent) => {
    if (event.data === this._options.heartbeat?.pongMessage) {
      this.handleHeartbeatReceived(event);
      return;
    }
    this.handleEvent(WebsocketEvent.message, event);
  };

  /**
   * Dispatch an event to all listeners of the given event-type.
   *
   * @param type of the event to dispatch.
   * @param event to dispatch.
   */
  private dispatchEvent<K extends WebsocketEvent>(
    type: K,
    event: WebsocketEventMap<Receive>[K]
  ) {
    const eventListeners: WebsocketEventListeners<Send, Receive>[K] =
      this._options.listeners[type];
    const newEventListeners: WebsocketEventListeners<Send, Receive>[K] = [];

    eventListeners.forEach(({ listener, options }) => {
      listener(this, event); // invoke listener with event

      if (
        options === undefined ||
        options.once === undefined ||
        !options.once
      ) {
        newEventListeners.push({ listener, options }); // only keep listener if it isn't a once-listener
      }
    });

    this._options.listeners[type] = newEventListeners; // replace old listeners with new listeners that don't include once-listeners
  }

  /**
   * Handles the given event by dispatching it to all listeners of the given event-type.
   *
   * @param type of the event to handle.
   * @param event to handle.
   */
  private handleEvent(
    type: WebsocketEvent,
    event: WebsocketEventMap<WebsocketData>[WebsocketEvent]
  ) {
    const eventWithType = {
      event,
      type,
      // Internal event handles have not yet deserialized the data
      // thus here it is WebsocketData and not Receive
    } as WebsocketEventUnion<WebsocketData>;

    match(eventWithType)
      .with({ type: WebsocketEvent.close }, () => {
        this.connectionState = WebsocketConnectionState.Closed;
        this.dispatchEvent(type, event);
        this.scheduleConnectionRetryIfNeeded();
        this.stopHeartbeat();
      })
      .with({ type: WebsocketEvent.open }, () => {
        if (this.backoff !== undefined && this._lastConnection !== undefined) {
          const detail: ReconnectEventDetail = {
            retries: this.backoff.retries,
            lastConnection: new Date(this._lastConnection),
            url: this._url,
          };
          const reconnectEvent = new CustomEvent<ReconnectEventDetail>(
            WebsocketEvent.reconnect,
            { detail }
          );
          this.dispatchEvent(WebsocketEvent.reconnect, reconnectEvent);
          this.backoff.reset();
        }

        if (this._options.heartbeat) {
          this.startHeartbeat();
        }

        this.connectionState = WebsocketConnectionState.Open;
        this._lastConnection = new Date();
        this.dispatchEvent(type, event);
        this.sendBufferedData();
      })
      .with({ type: WebsocketEvent.retry }, () => {
        this.connectionState = WebsocketConnectionState.Reconnecting;
        this.dispatchEvent(type, event);
        this.clearWebsocket();
        this.tryConnect();
      })
      .with({ type: WebsocketEvent.error }, () => {
        this.connectionState = WebsocketConnectionState.Closing;
        this.dispatchEvent(type, event);
      })
      .with({ type: WebsocketEvent.message }, ({ event }) => {
        const data = deserializeIfNeeded(event.data, this._options.serializer);
        const newEvent = new MessageEvent('message', {
          data,
          origin: event.origin,
          lastEventId: event.lastEventId,
          source: event.source,
        });
        this.dispatchEvent(WebsocketEvent.message, newEvent);
      })
      .with(
        {
          type: P.union(
            WebsocketEvent.reconnect,
            WebsocketEvent.heartbeatSent,
            WebsocketEvent.heartbeatReceived,
            WebsocketEvent.heartbeatMissed
          ),
        },
        () => {
          this.dispatchEvent(type, event);
        }
      )
      .exhaustive();
  }

  /**
   * Sends buffered data if there is a buffer defined.
   */
  private sendBufferedData() {
    if (this.buffer === undefined) {
      return; // no buffer defined, nothing to send
    }

    for (
      let ele = this.buffer.read();
      ele !== undefined;
      ele = this.buffer.read()
    ) {
      this.send(ele); // send buffered data
    }
  }

  /**
   * Schedules a connection-retry if there is a backoff defined and the websocket was not closed by the user.
   */
  private scheduleConnectionRetryIfNeeded() {
    if (this.closedByUser) {
      return; // user closed the websocket, no retry
    }
    if (this.backoff === undefined) {
      return; // no backoff defined, no retry
    }

    // handler dispatches the retry event to all listeners of the retry event-type
    const handleRetryEvent = (detail: RetryEventDetail) => {
      const event: CustomEvent<RetryEventDetail> = new CustomEvent(
        WebsocketEvent.retry,
        { detail }
      );
      this.handleEvent(WebsocketEvent.retry, event);
    };

    // create retry event detail, depending on the 'instantReconnect' option
    const retryEventDetail: RetryEventDetail = {
      backoff:
        this._options.retry.instantReconnect === true ? 0 : this.backoff.next(),
      retries:
        this._options.retry.instantReconnect === true
          ? 0
          : this.backoff.retries,
      lastConnection: this._lastConnection,
      url: this._url,
    };

    // schedule a new connection-retry if the maximum number of retries is not reached yet
    if (
      this._options.retry.maxRetries === undefined ||
      retryEventDetail.retries <= this._options.retry.maxRetries
    ) {
      this.retryTimeout = globalThis.setTimeout(
        () => handleRetryEvent(retryEventDetail),
        retryEventDetail.backoff
      );
    }
  }

  /**
   * Cancels the scheduled connection-retry, if there is one.
   */
  private cancelScheduledConnectionRetry() {
    globalThis.clearTimeout(this.retryTimeout);
  }

  /**
   * Handles the heartbeat timeout.
   * If we don't receive a pong we will increment the missedHeartbeats counter and check if we should reconnect.
   */
  private handleHeartbeatTimeout() {
    this.missedHeartbeats++;
    if (!isRequiredHeartbeatOptions(this._options?.heartbeat)) {
      console.warn(
        'Heartbeat options are not set. Heartbeats will not handle timeout.'
      );
      return;
    }

    const shouldReconnect =
      this.missedHeartbeats > this._options.heartbeat.maxMissedHeartbeats;

    const event = new CustomEvent<HeartbeatMissedEventDetail>(
      WebsocketEvent.heartbeatMissed,
      {
        detail: {
          missedHeartbeats: this.missedHeartbeats,
          willReconnect:
            this.missedHeartbeats > this._options.heartbeat.maxMissedHeartbeats,
        },
      }
    );

    this.dispatchEvent(WebsocketEvent.heartbeatMissed, event);

    if (shouldReconnect) {
      // Close the underlying websocket and trigger a reconnect
      this._underlyingWebsocket.close(1000, 'No heartbeat received');
    }
  }

  /**
   * Sends a heartbeat message to the websocket.
   * Schedules a timeout for `this._options.heartbeat.timeout` milliseconds.
   * If we don't receive a pong we will increment the missedHeartbeats counter and check if we should reconnect.
   */
  private sendHeartbeat() {
    if (!this._underlyingWebsocket) return;
    if (!isRequiredHeartbeatOptions(this._options?.heartbeat)) {
      console.warn(
        'Heartbeat options are not set. Heartbeats will not be sent.'
      );
      return;
    }

    this._underlyingWebsocket.send(this._options.heartbeat.pingMessage);

    const event = new CustomEvent<HeartbeatEventDetail>(
      WebsocketEvent.heartbeatReceived,
      {
        detail: {
          message: this._options.heartbeat.pingMessage,
          timestamp: Date.now(),
        },
      }
    );

    this.dispatchEvent(WebsocketEvent.heartbeatSent, event);

    this.heartbeatTimeout = setTimeout(
      () => this.handleHeartbeatTimeout(),
      this._options.heartbeat.timeout
    );
  }

  /** Returns whether the heartbeat is running. */
  isHeartbeatRunning(): boolean {
    return this.heartbeatInterval !== undefined;
  }

  /**
   * Stops the heartbeat interval and timeout.
   */
  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = undefined;
    }

    this.missedHeartbeats = 0;
  }

  /**
   * Starts a new heartbeat interval.
   */
  private startHeartbeat() {
    this.stopHeartbeat();
    this.missedHeartbeats = 0;
    if (!isRequiredHeartbeatOptions(this._options?.heartbeat)) {
      console.warn(
        'Heartbeat options are not set. Heartbeats will not be started.'
      );
      return;
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.connectionState === WebsocketConnectionState.Open) {
        this.sendHeartbeat();
      }
    }, this._options.heartbeat.interval);
  }

  reconnect() {
    this.close();
    this.tryConnect();
  }
}
