import { isTauri } from '@core/util/platform';
import { Channel, invoke } from '@tauri-apps/api/core';
import { match } from 'ts-pattern';
import type { MinimalWebSocket, WebSocketFactory } from './minimal-websocket';

// This wrapper talks to the tauri websocket plugin's IPC surface directly
// instead of going through @tauri-apps/plugin-websocket's JS glue:
// - connect: we must pre-register our message handler BEFORE the connection
//   is made, which the stock wrapper does not allow
//   (https://github.com/tauri-apps/plugins-workspace/issues/3152)
// - recover: only exists in our fork
// The types below mirror the crate pinned in tauri/src-tauri/Cargo.toml
// (github.com/seanaye/plugins-workspace, branch seanaye/feat/ws-replay-buffer,
// plugins/websocket/src/lib.rs) and must be kept in sync with it.

interface TauriMessageKind<T, D> {
  type: T;
  data: D;
}

interface TauriCloseFrame {
  code: number;
  reason: string;
}

type TauriMessage =
  | TauriMessageKind<'Text', string>
  | TauriMessageKind<'Binary', number[]>
  | TauriMessageKind<'Ping', number[]>
  | TauriMessageKind<'Pong', number[]>
  | TauriMessageKind<'Close', TauriCloseFrame | null>;

/**
 * Envelope emitted by our fork of the websocket plugin
 * (seanaye/feat/ws-replay-buffer). Every incoming message carries a
 * per-connection sequence number so missed messages can be recovered after
 * the webview was suspended.
 */
interface ReplayEnvelope {
  seq: number;
  message: TauriMessage;
}

interface RecoverResponse {
  messages: ReplayEnvelope[];
  /**
   * True when messages newer than `after` were already evicted from the
   * Rust-side replay buffer; the connection must be resynced.
   */
  gap: boolean;
}

/**
 * Tauri WebSocket wrapper that implements MinimalWebSocket interface
 */
class TauriWebSocketWrapper implements MinimalWebSocket {
  private socketId: number | null = null; // plugin connection id
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

  // Replay/recovery state (see seanaye/feat/ws-replay-buffer)
  private lastSeq = 0;
  private recovering = false;
  private queued: ReplayEnvelope[] = [];
  private deliver?: (envelope: ReplayEnvelope) => void;
  private visibilityHandler?: () => void;

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

      // We call invoke() directly and pre-register our handler BEFORE the
      // connection is made, so messages sent by the server immediately after
      // the handshake cannot be dropped (see module comment above).
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

      // Unwrap the { seq, message } replay envelope, deduplicating messages
      // that are delivered both live and via recover().
      //
      // Note: the live path can never present a forward gap (seq > lastSeq + 1
      // with the hole unfilled). Tauri's Channel delivers messages strictly
      // in-order (out-of-order arrivals are buffered internally), and
      // recover() verifies contiguity Rust-side via the `gap` flag. Lost
      // channel messages stall inside the Channel instead, which is exactly
      // what recover() compensates for.
      const deliver = (envelope: ReplayEnvelope) => {
        if (envelope.seq > 0) {
          if (envelope.seq <= this.lastSeq) {
            return;
          }
          this.lastSeq = envelope.seq;
        }
        listeners.forEach((l) => {
          l(envelope.message);
        });
      };
      this.deliver = deliver;

      const onMessage = new Channel<ReplayEnvelope>();
      onMessage.onmessage = (envelope: ReplayEnvelope) => {
        if (this.recovering) {
          this.queued.push(envelope);
        } else {
          deliver(envelope);
        }
      };

      const id = await invoke<number>('plugin:websocket|connect', {
        url,
        onMessage,
      });
      this.socketId = id;

      this.removeListener = () => {
        listeners.delete(handleMessage);
      };

      this._readyState = this.OPEN;

      // Recover messages received by the Rust side while the webview was
      // suspended (e.g. iOS backgrounding) whenever we become visible again.
      this.visibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          void this.recover();
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);

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
    this.teardownVisibilityListener();
    if (this.onclose) {
      this.onclose.call(this as any, event);
    }
    this.dispatchToEventListeners('close', event);
  }

  private teardownVisibilityListener() {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = undefined;
    }
  }

  /**
   * Requests redelivery of messages that were received by the Rust side but
   * did not reach this webview. If the replay buffer no longer covers the
   * missed range (gap), the connection is force-closed so the upper layer
   * reconnects and resyncs.
   */
  private async recover(): Promise<void> {
    if (
      this.socketId === null ||
      this._readyState !== this.OPEN ||
      this.recovering
    ) {
      return;
    }
    this.recovering = true;
    // Set when missed messages cannot be recovered: either the replay buffer
    // no longer covers them (gap) or the recover call itself failed. In both
    // cases we must not continue with a hole in the stream.
    let needsResync = false;
    try {
      const res = await invoke<RecoverResponse>('plugin:websocket|recover', {
        id: this.socketId,
        after: this.lastSeq,
      });
      for (const envelope of res.messages) {
        this.deliver?.(envelope);
      }
      needsResync = res.gap;
    } catch (error) {
      console.error(`Tauri WebSocket recover failed for ${this._url}:`, error);
      needsResync = true;
    } finally {
      const queued = this.queued;
      this.queued = [];
      this.recovering = false;
      if (!needsResync) {
        // flush messages that arrived live while we were recovering
        for (const envelope of queued) {
          this.deliver?.(envelope);
        }
      }
      // when resyncing, the queued envelopes are dropped: the forced
      // reconnect below triggers a full resync that covers them
    }
    if (needsResync) {
      console.warn(
        `Tauri WebSocket ${this._url}: unrecoverable missed messages, forcing reconnect`
      );
      this.disconnectSocket().catch(() => {});
      this._readyState = this.CLOSED;
      this.removeListener?.();
      this.handleError(new Event('error'));
      this.handleClose(
        new CloseEvent('close', {
          code: 1006,
          reason: 'Replay gap detected',
          wasClean: false,
        })
      );
    }
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

  /** Sends a message over the plugin connection. */
  private async sendMessage(message: TauriMessage): Promise<void> {
    await invoke('plugin:websocket|send', {
      id: this.socketId,
      message,
    });
  }

  /** Closes the plugin connection with a normal-closure frame. */
  private async disconnectSocket(): Promise<void> {
    await this.sendMessage({
      type: 'Close',
      data: {
        code: 1000,
        reason: 'Disconnected by client',
      },
    });
  }

  close(_code?: number, _reason?: string): void {
    if (this.socketId !== null && this._readyState === this.OPEN) {
      this._readyState = this.CLOSING;

      // Tauri WebSocket disconnect doesn't take parameters, so we just disconnect
      this.disconnectSocket()
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
    if (this.socketId === null || this._readyState !== this.OPEN) {
      throw new Error(
        `Websocket to: ${this.url} is in state ${this._readyState}`
      );
    }

    if (typeof data === 'string') {
      // Send as text message
      this.sendMessage({ type: 'Text', data }).catch((e: unknown) =>
        this.handleSendRejection(e)
      );
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
      this.sendMessage({ type: 'Binary', data: Array.from(uint8Array) }).catch(
        (e: unknown) => this.handleSendRejection(e)
      );
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
