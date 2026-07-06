import type { MinimalWebSocket, WebSocketFactory } from '../minimal-websocket';
import { intoFrames, Reassembler } from './frames';

class FramedWebSocket implements MinimalWebSocket {
  /** 'message' listeners, routed through us so reassembly can interpose. */
  private readonly messageListeners = new Set<EventListener>();

  /** Per-connection inbound reassembly (frames arrive in order over one socket). */
  private readonly reassembler = new Reassembler();

  constructor(private readonly inner: MinimalWebSocket) {
    this.inner.addEventListener('message', this.handleInnerMessage);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    // Strings (heartbeat ping/pong) ride the text channel — never framed.
    if (typeof data === 'string') {
      this.inner.send(data);
      return;
    }
    for (const frame of intoFrames(toBytes(data))) {
      this.inner.send(frame);
    }
  }

  private handleInnerMessage = (event: MessageEvent): void => {
    // Strings (heartbeat pong) pass straight through.
    if (typeof event.data === 'string') {
      this.dispatchMessage(event);
      return;
    }
    const message = this.reassembler.push(new Uint8Array(event.data));
    if (message === null) return; // partial — waiting for more frames
    this.dispatchMessage(new MessageEvent('message', { data: message.buffer }));
  };

  private dispatchMessage(event: MessageEvent): void {
    this.messageListeners.forEach((listener) => listener(event));
  }

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

/** Normalizes a binary payload to a `Uint8Array` view for framing. */
function toBytes(data: ArrayBufferLike | Blob | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error('FramedWebSocket: unsupported binary payload type');
}
