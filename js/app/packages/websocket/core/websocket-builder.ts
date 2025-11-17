import type { WebSocketFactory } from '../platform/minimal-websocket';
import type { Backoff } from './backoff/backoff';
import { Websocket } from './websocket';
import type { WebsocketBuffer } from './websocket-buffer';
import {
  WebsocketEvent,
  type WebsocketEventListener,
  type WebsocketEventListenerOptions,
} from './websocket-event';
import type { WebsocketHeartbeatOptions } from './websocket-heartbeat-options';
import type { WebsocketOptions } from './websocket-options';
import type {
  WebsocketData,
  WebsocketSerializer,
} from './websocket-serializer';
import type { UrlResolver } from './websocket-url-resolver';

/**
 * Builder for websockets.
 */
export class WebsocketBuilder<Send = WebsocketData, Receive = WebsocketData> {
  private readonly _urlResolver: UrlResolver;

  private _protocols?: string | string[];
  private _options?: WebsocketOptions<Send, Receive>;

  /**
   * Creates a new WebsocketBuilder.
   *
   * @param url the url to connect to
   */
  constructor(resolver: UrlResolver) {
    this._urlResolver = resolver;
  }

  /**
   * Getter for the url.
   *
   * @returns the url
   */
  get url(): UrlResolver {
    return this._urlResolver;
  }

  /**
   * Adds protocols to the websocket. Subsequent calls to this method will override the previously set protocols.
   *
   * @param protocols the protocols to add
   */
  public withProtocols(
    protocols: string | string[] | undefined
  ): WebsocketBuilder<Send, Receive> {
    this._protocols = protocols;
    return this;
  }

  /**
   * Adds a factory to the websocket. Subsequent calls to this method will override the previously set factory.
   *
   * @param factory the factory to add
   * */
  public withFactory(
    factory: WebSocketFactory
  ): WebsocketBuilder<Send, Receive> {
    this._options = {
      ...this._options,
      factory,
    };
    return this;
  }

  /**
   * Getter for the protocols.
   *
   * @returns the protocols, undefined if no protocols have been set
   */
  get protocols(): string | string[] | undefined {
    return this._protocols;
  }

  /**
   * Sets the maximum number of retries before giving up. No limit if undefined.
   *
   * @param maxRetries the maximum number of retries before giving up
   */
  public withMaxRetries(
    maxRetries: number | undefined
  ): WebsocketBuilder<Send, Receive> {
    this._options = {
      ...this._options,
      retry: { ...this._options?.retry, maxRetries },
    };
    return this;
  }

  /**
   * Getter for the maximum number of retries before giving up.
   *
   * @returns the maximum number of retries before giving up, undefined if no maximum has been set
   */
  get maxRetries(): number | undefined {
    return this._options?.retry?.maxRetries;
  }

  /**
   * Sets wether to reconnect immediately after a connection has been lost, ignoring the backoff strategy for the first retry.
   *
   * @param instantReconnect wether to reconnect immediately after a connection has been lost
   */
  public withInstantReconnect(
    instantReconnect: boolean | undefined
  ): WebsocketBuilder<Send, Receive> {
    this._options = {
      ...this._options,
      retry: { ...this._options?.retry, instantReconnect },
    };
    return this;
  }

  /**
   * Getter for wether to reconnect immediately after a connection has been lost, ignoring the backoff strategy for the first retry.
   *
   * @returns wether to reconnect immediately after a connection has been lost, undefined if no value has been set
   */
  get instantReconnect(): boolean | undefined {
    return this._options?.retry?.instantReconnect;
  }

  /**
   * Adds a backoff to the websocket. Subsequent calls to this method will override the previously set backoff.
   *
   * @param backoff the backoff to add
   */
  public withBackoff(
    backoff: Backoff | undefined
  ): WebsocketBuilder<Send, Receive> {
    this._options = {
      ...this._options,
      retry: { ...this._options?.retry, backoff },
    };
    return this;
  }

  /**
   * Getter for the backoff.
   *
   * @returns the backoff, undefined if no backoff has been set
   */
  get backoff(): Backoff | undefined {
    return this._options?.retry?.backoff;
  }

  /**
   * Adds a buffer to the websocket. Subsequent calls to this method will override the previously set buffer.
   *
   * @param buffer the buffer to add
   */
  public withBuffer(
    buffer: WebsocketBuffer<Send> | undefined
  ): WebsocketBuilder<Send, Receive> {
    this._options = { ...this._options, buffer };
    return this;
  }

  /**
   * Adds a heartbeat to the websocket. Subsequent calls to this method will override the previously set heartbeat.
   *
   * @param options the heartbeat to add
   */
  public withHeartbeat(
    options: WebsocketHeartbeatOptions
  ): WebsocketBuilder<Send, Receive> {
    this._options = { ...this._options, heartbeat: options };
    return this;
  }

  /**
   * Adds a serializer to the websocket. Subsequent calls to this method will override the previously set serializer.
   *
   * @param serializer the serializer to add
   */
  public withSerializer<NewSend, NewReceive>(
    serializer: WebsocketSerializer<NewSend, NewReceive>
  ): WebsocketBuilder<NewSend, NewReceive> {
    const newBuilder = new WebsocketBuilder<NewSend, NewReceive>(
      this._urlResolver
    );
    newBuilder._protocols = this._protocols;
    newBuilder._options = {
      retry: this._options?.retry,
      heartbeat: this._options?.heartbeat,
      listeners: this._options?.listeners,
      serializer,
      buffer: this._options?.buffer,
    } as WebsocketOptions<NewSend, NewReceive>;

    if (serializer.binaryType !== undefined) {
      return newBuilder.withBinaryType(serializer.binaryType);
    }

    return newBuilder;
  }

  /**
   * Getter for the buffer.
   *
   * @returns the buffer, undefined if no buffer has been set
   */
  get buffer(): WebsocketBuffer<Send> | undefined {
    return this._options?.buffer;
  }

  /**
   * Sets the binaryType of the websocket.
   *
   * @param binaryType to set.
   * @returns the builder itself.
   */
  public withBinaryType(
    binaryType: BinaryType
  ): WebsocketBuilder<Send, Receive> {
    this._options = {
      ...this._options,
      binaryType,
    };
    return this;
  }

  /**
   * Adds an 'open' event listener to the websocket. Subsequent calls to this method will add additional listeners that will be
   * called in the order they were added.
   *
   * @param listener the listener to add
   * @param options the listener options
   */
  public onOpen(
    listener: WebsocketEventListener<WebsocketEvent.open, Send, Receive>,
    options?: WebsocketEventListenerOptions
  ): WebsocketBuilder<Send, Receive> {
    this.addListener(WebsocketEvent.open, listener, options);
    return this;
  }

  /**
   * Adds an 'close' event listener to the websocket. Subsequent calls to this method will add additional listeners that will be
   * called in the order they were added.
   *
   * @param listener the listener to add
   * @param options the listener options
   */
  public onClose(
    listener: WebsocketEventListener<WebsocketEvent.close, Send, Receive>,
    options?: WebsocketEventListenerOptions
  ): WebsocketBuilder<Send, Receive> {
    this.addListener(WebsocketEvent.close, listener, options);
    return this;
  }

  /**
   * Adds an 'error' event listener to the websocket. Subsequent calls to this method will add additional listeners that will be
   * called in the order they were added.
   *
   * @param listener the listener to add
   * @param options the listener options
   */
  public onError(
    listener: WebsocketEventListener<WebsocketEvent.error, Send, Receive>,
    options?: WebsocketEventListenerOptions
  ): WebsocketBuilder<Send, Receive> {
    this.addListener(WebsocketEvent.error, listener, options);
    return this;
  }

  /**
   * Adds an 'message' event listener to the websocket. Subsequent calls to this method will add additional listeners that will be
   * called in the order they were added.
   *
   * @param listener the listener to add
   * @param options the listener options
   */
  public onMessage(
    listener: WebsocketEventListener<WebsocketEvent.message, Send, Receive>,
    options?: WebsocketEventListenerOptions
  ): WebsocketBuilder<Send, Receive> {
    this.addListener(WebsocketEvent.message, listener, options);
    return this;
  }

  /**
   * Adds an 'retry' event listener to the websocket. Subsequent calls to this method will add additional listeners that will be
   * called in the order they were added.
   *
   * @param listener the listener to add
   * @param options the listener options
   */
  public onRetry(
    listener: WebsocketEventListener<WebsocketEvent.retry, Send, Receive>,
    options?: WebsocketEventListenerOptions
  ): WebsocketBuilder<Send, Receive> {
    this.addListener(WebsocketEvent.retry, listener, options);
    return this;
  }

  /**
   * Adds an 'reconnect' event listener to the websocket. Subsequent calls to this method will add additional listeners that will be
   * called in the order they were added.
   *
   * @param listener the listener to add
   * @param options the listener options
   */
  public onReconnect(
    listener: WebsocketEventListener<WebsocketEvent.reconnect, Send, Receive>,
    options?: WebsocketEventListenerOptions
  ): WebsocketBuilder<Send, Receive> {
    this.addListener(WebsocketEvent.reconnect, listener, options);
    return this;
  }

  /**
   * Adds an 'heartbeatSent' event listener to the websocket. Subsequent calls to this method will add additional listeners that will be
   * called in the order they were added.
   *
   * @param listener the listener to add
   * @param options the listener options
   */
  public onHeartbeatSent(
    listener: WebsocketEventListener<
      WebsocketEvent.heartbeatSent,
      Send,
      Receive
    >,
    options?: WebsocketEventListenerOptions
  ): WebsocketBuilder<Send, Receive> {
    this.addListener(WebsocketEvent.heartbeatSent, listener, options);
    return this;
  }

  /**
   * Adds an 'heartbeatReceived' event listener to the websocket. Subsequent calls to this method will add additional listeners that will be
   * called in the order they were added.
   *
   * @param listener the listener to add
   * @param options the listener options
   */
  public onHeartbeatReceived(
    listener: WebsocketEventListener<
      WebsocketEvent.heartbeatSent,
      Send,
      Receive
    >,
    options?: WebsocketEventListenerOptions
  ): WebsocketBuilder<Send, Receive> {
    this.addListener(WebsocketEvent.heartbeatReceived, listener, options);
    return this;
  }

  /**
   * Adds an 'heartbeatMissed' event listener to the websocket. Subsequent calls to this method will add additional listeners that will be
   * called in the order they were added.
   *
   * @param listener the listener to add
   * @param options the listener options
   */
  public onHeartbeatMissed(
    listener: WebsocketEventListener<
      WebsocketEvent.heartbeatMissed,
      Send,
      Receive
    >,
    options?: WebsocketEventListenerOptions
  ): WebsocketBuilder<Send, Receive> {
    this.addListener(WebsocketEvent.heartbeatMissed, listener, options);
    return this;
  }

  /**
   * Builds the websocket.
   *
   * @return a new websocket, with the set options
   */
  public build(): Websocket<Send, Receive> {
    const ws = new Websocket<Send, Receive>(
      this._urlResolver,
      this._protocols,
      this._options as WebsocketOptions<Send, Receive>
    ); // instantiate the websocket with the set options

    return ws;
  }

  /**
   * Adds an event listener to the options.
   *
   * @param event the event to add the listener to
   * @param listener the listener to add
   * @param options the listener options
   */
  private addListener<K extends WebsocketEvent>(
    event: WebsocketEvent,
    listener: WebsocketEventListener<K, Send, Receive>,
    options?: WebsocketEventListenerOptions
  ): WebsocketBuilder<Send, Receive> {
    this._options = {
      ...this._options,
      listeners: {
        open: this._options?.listeners?.open ?? [],
        close: this._options?.listeners?.close ?? [],
        error: this._options?.listeners?.error ?? [],
        message: this._options?.listeners?.message ?? [],
        retry: this._options?.listeners?.retry ?? [],
        reconnect: this._options?.listeners?.reconnect ?? [],
        heartbeatSent: this._options?.listeners?.heartbeatSent ?? [],
        heartbeatReceived: this._options?.listeners?.heartbeatReceived ?? [],
        heartbeatMissed: this._options?.listeners?.heartbeatMissed ?? [],
        [event]: [
          ...(this._options?.listeners?.[event] ?? []),
          { listener, options },
        ],
      },
    };
    return this;
  }
}
