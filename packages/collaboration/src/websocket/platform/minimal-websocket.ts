/**
 * Minimal WebSocket interface capturing only the methods and properties
 * used by the DurableSocket implementation
 */
export interface MinimalWebSocket {
  // Properties
  binaryType: BinaryType;
  readonly bufferedAmount: number;
  readonly extensions: string;
  readonly protocol: string;
  readonly readyState: number;
  readonly url: string;

  // Event handlers
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null;
  onerror: ((this: WebSocket, ev: Event) => any) | null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null;
  onopen: ((this: WebSocket, ev: Event) => any) | null;

  // Methods
  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void;

  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | EventListenerOptions
  ): void;

  dispatchEvent(event: Event): boolean;

  close(code?: number, reason?: string): void;

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;

  // WebSocket state constants
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;
}

/**
 * Factory function type for creating WebSocket instances
 */
export type WebSocketFactory = (
  url: string | URL,
  protocols?: string | string[]
) => MinimalWebSocket;

/**
 * Default factory that creates native WebSocket instances
 */
export const browserWebSocketFactory: WebSocketFactory = (url, protocols) => {
  return new WebSocket(url, protocols) as MinimalWebSocket;
};
