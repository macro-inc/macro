import { isTauri } from '@core/util/platform';
import { Channel, invoke } from '@tauri-apps/api/core';
import TauriWebsocket, {
  type Message as TauriMessage,
} from '@tauri-apps/plugin-websocket';
import { match } from 'ts-pattern';
import type { MinimalWebSocket, WebSocketFactory } from './minimal-websocket';

/**
 * Tauri WebSocket wrapper that implements MinimalWebSocket interface
 */
class TauriWebSocketWrapper implements MinimalWebSocket {
  private ws: TauriWebsocket; // Tauri WebSocket instance
  private _readyState: number = 0; // CONNECTING
  private _url: string;
  private _protocol: string = '';
  private _extensions: string = '';
  private _binaryType: BinaryType = 'blob';
  private _bufferedAmount: number = 0;

  // Event handlers
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
  onerror: ((this: WebSocket, ev: Event) => any) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
  onopen: ((this: WebSocket, ev: Event) => any) | null = null;

  private eventListeners: Map<string, Set<EventListener>> = new Map();
  private removeListener?: () => void;

  // WebSocket state constants
  readonly CONNECTING: 0 = 0;
  readonly OPEN: 1 = 1;
  readonly CLOSING: 2 = 2;
  readonly CLOSED: 3 = 3;

  constructor(url: string, protocols?: string | string[]) {
    this._url = url;
    this.initializeWebSocket(url, protocols);
  }

  private async initializeWebSocket(
    url: string,
    protocols?: string | string[]
  ) {
    try {
      // The Tauri websocket plugin does not support subprotocol negotiation, so
      // we keep the shared factory signature for compatibility but do not
      // forward `protocols` to the plugin connect call.
      void protocols;

      // Workaround for https://github.com/tauri-apps/plugins-workspace/issues/3152:
      // TauriWebsocket.connect() only exposes the listeners Set after it resolves, so
      // messages sent by the server immediately after the handshake can arrive via IPC
      // before addListener() is called and get dropped. Instead, we call invoke()
      // directly and pre-register our handler BEFORE the connection is made.
      const listeners = new Set<(message: TauriMessage) => void>();

      const handleMessage = (message: TauriMessage) => {
        match(message)
          .with({ type: 'Text' }, ({ data }) => {
            this.handleMessage(data);
          })
          .with({ type: 'Binary' }, ({ data }) => {
            // Convert number array back to Uint8Array/Blob based on binaryType
            const messageData =
              this._binaryType === 'arraybuffer'
                ? new Uint8Array(data).buffer
                : new Blob([new Uint8Array(data)]);
            this.handleMessage(messageData);
          })
          .with({ type: 'Close' }, ({ data }) => {
            this._readyState = this.CLOSED;
            const closeEvent = new CloseEvent('close', {
              code: data?.code || 1000,
              reason: data?.reason || '',
              wasClean: true,
            });
            this.handleClose(closeEvent);
          })
          .with({ type: 'Ping' }, () => {
            // Handle ping (usually automatic)
          })
          .with({ type: 'Pong' }, () => {
            // Handle pong (usually automatic)
          })
          .exhaustive();
      };

      // Register BEFORE invoke so any message that arrives during the handshake
      // is dispatched to our handler rather than dropped into an empty Set.
      listeners.add(handleMessage);

      const onMessage = new Channel<TauriMessage>();
      onMessage.onmessage = (message: TauriMessage) => {
        listeners.forEach((l) => {
          l(message);
        });
      };

      const id = await invoke<number>('plugin:websocket|connect', {
        url,
        onMessage,
      });

      // Reconstruct a TauriWebsocket instance from the connection id and our
      // pre-populated listeners Set, matching the internal shape of the plugin class.
      this.ws = new (
        TauriWebsocket as unknown as new (
          id: number,
          listeners: Set<(arg: TauriMessage) => void>
        ) => TauriWebsocket
      )(id, listeners);

      this.removeListener = () => {
        listeners.delete(handleMessage);
      };

      this._readyState = this.OPEN;
      console.log(`initialized tauri websocket for ${url}`);
      // Trigger open event
      const openEvent = new Event('open');
      this.handleOpen(openEvent);
    } catch (error) {
      console.error(`Failed to initialize Tauri WebSocket to ${url}:`, error);
      this._readyState = this.CLOSED;
      const errorEvent = new Event('error');
      this.handleError(errorEvent);
      // Fire a close event so the Websocket layer can schedule retries,
      // matching native WebSocket behaviour where error is always followed by close.
      const closeEvent = new CloseEvent('close', {
        code: 1006,
        reason: 'Connection failed',
        wasClean: false,
      });
      this.handleClose(closeEvent);
    }
  }

  private handleMessage(data: any) {
    const event = new MessageEvent('message', { data });
    if (this.onmessage) {
      this.onmessage.call(this as any, event);
    }
    this.dispatchToEventListeners('message', event);
  }

  private handleOpen(event: Event) {
    if (this.onopen) {
      this.onopen.call(this as any, event);
    }
    this.dispatchToEventListeners('open', event);
  }

  private handleClose(event: CloseEvent) {
    if (this.onclose) {
      this.onclose.call(this as any, event);
    }
    this.dispatchToEventListeners('close', event);
  }

  private handleError(event: Event) {
    if (this.onerror) {
      this.onerror.call(this as any, event);
    }
    this.dispatchToEventListeners('error', event);
  }

  private dispatchToEventListeners(type: string, event: Event) {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          console.error('Error in event listener:', error);
        }
      });
    }
  }

  // Properties
  get binaryType(): BinaryType {
    return this._binaryType;
  }

  set binaryType(value: BinaryType) {
    this._binaryType = value;
  }

  get bufferedAmount(): number {
    return this._bufferedAmount;
  }

  get extensions(): string {
    return this._extensions;
  }

  get protocol(): string {
    return this._protocol;
  }

  get readyState(): number {
    return this._readyState;
  }

  get url(): string {
    return this._url;
  }

  // Methods
  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    _options?: boolean | AddEventListenerOptions
  ): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }

    this.eventListeners.get(type)!.add(listener as EventListener);
  }

  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    _options?: boolean | EventListenerOptions
  ): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.delete(listener as EventListener);
    }
  }

  dispatchEvent(event: Event): boolean {
    this.dispatchToEventListeners(event.type, event);
    return true;
  }

  close(_code?: number, _reason?: string): void {
    if (this.ws && this._readyState === this.OPEN) {
      this._readyState = this.CLOSING;

      // Tauri WebSocket disconnect doesn't take parameters, so we just disconnect
      this.ws
        .disconnect()
        .catch((error: any) => {
          console.error('Error closing Tauri WebSocket:', error);
        })
        .finally(() => {
          this._readyState = this.CLOSED;
          if (this.removeListener) {
            this.removeListener();
          }
        });
    }
  }

  private handleSendRejection(error: unknown) {
    if (this._readyState === this.CLOSING || this._readyState === this.CLOSED)
      return;
    console.error(`Tauri WebSocket send error for ${this._url}:`, error);
    this._readyState = this.CLOSED;
    this.removeListener?.();
    this.handleError(new Event('error'));
    this.handleClose(
      new CloseEvent('close', {
        code: 1006,
        reason: 'Send failed',
        wasClean: false,
      })
    );
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (!this.ws || this._readyState !== this.OPEN) {
      throw new Error(
        `Websocket to: ${this.url} is in state ${this._readyState}`
      );
    }

    if (typeof data === 'string') {
      // Send as text message
      this.ws
        .send({ type: 'Text', data })
        .catch((e: unknown) => this.handleSendRejection(e));
    } else {
      // Convert binary data to number array for Tauri
      let uint8Array: Uint8Array;

      if (data instanceof ArrayBuffer) {
        uint8Array = new Uint8Array(data);
      } else if (data instanceof Uint8Array) {
        uint8Array = data;
      } else if (data instanceof Blob) {
        // For Blob, we need to read it first (this is async in real implementation)
        throw new Error(
          'Blob sending requires async handling - convert to ArrayBuffer first'
        );
      } else if (
        'buffer' in data &&
        'byteOffset' in data &&
        'byteLength' in data
      ) {
        // Handle ArrayBufferView types
        uint8Array = new Uint8Array(
          data.buffer,
          data.byteOffset,
          data.byteLength
        );
      } else {
        // Handle SharedArrayBuffer
        uint8Array = new Uint8Array(data);
      }

      // Send as binary message with number array
      this.ws
        .send({ type: 'Binary', data: Array.from(uint8Array) })
        .catch((e: unknown) => this.handleSendRejection(e));
    }
  }
}

/**
 * Tauri WebSocket factory that lazy loads the Tauri WebSocket plugin
 */
export const tauriWebSocketFactory: WebSocketFactory = (url, protocols) => {
  if (!isTauri()) {
    throw new Error('TauriWebSocket can only be used in Tauri environments');
  }

  return new TauriWebSocketWrapper(url.toString(), protocols);
};
