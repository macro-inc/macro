import type { MinimalWebSocket, WebSocketFactory } from './minimal-websocket';

class FramedWebSocket implements MinimalWebSocket {
  /** 'message' listeners, routed through us so reassembly can interpose. */
  private readonly messageListeners = new Set<EventListener>();

  constructor(private readonly inner: MinimalWebSocket) {
    this.inner.addEventListener('message', this.handleInnerMessage);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    // TODO(chunking): split binary `data` into framed chunks before sending.
    this.inner.send(data);
  }

  private handleInnerMessage = (event: MessageEvent): void => {
    // TODO(chunking): buffer frames and dispatch only once a message is whole.
    this.messageListeners.forEach((listener) => listener(event));
  };

  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (type === 'message') {
      this.messageListeners.add(listener as EventListener);
    } else {
      this.inner.addEventListener(type, listener, options);
    }
  }

  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | EventListenerOptions
  ): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as EventListener);
    } else {
      this.inner.removeEventListener(type, listener, options);
    }
  }

  dispatchEvent(event: Event): boolean {
    return this.inner.dispatchEvent(event);
  }

  get binaryType(): BinaryType {
    return this.inner.binaryType;
  }

  set binaryType(value: BinaryType) {
    this.inner.binaryType = value;
  }

  get bufferedAmount(): number {
    return this.inner.bufferedAmount;
  }

  get extensions(): string {
    return this.inner.extensions;
  }

  get protocol(): string {
    return this.inner.protocol;
  }

  get readyState(): number {
    return this.inner.readyState;
  }

  get url(): string {
    return this.inner.url;
  }

  close(code?: number, reason?: string): void {
    this.inner.close(code, reason);
  }

  get onopen() {
    return this.inner.onopen;
  }

  set onopen(value) {
    this.inner.onopen = value;
  }

  get onclose() {
    return this.inner.onclose;
  }

  set onclose(value) {
    this.inner.onclose = value;
  }

  get onerror() {
    return this.inner.onerror;
  }

  set onerror(value) {
    this.inner.onerror = value;
  }

  get onmessage() {
    return this.inner.onmessage;
  }

  set onmessage(value) {
    this.inner.onmessage = value;
  }

  readonly CONNECTING = 0 as const;
  readonly OPEN = 1 as const;
  readonly CLOSING = 2 as const;
  readonly CLOSED = 3 as const;
}

/**
 * Wraps a base factory so the sockets it produces run through.
 */
export const framedWebSocketFactory =
  (base: WebSocketFactory): WebSocketFactory =>
  (url, protocols) =>
    new FramedWebSocket(base(url, protocols));
