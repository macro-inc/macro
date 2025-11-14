import type { MinimalWebSocket } from './MinimalWebSocket';

/**
 * Mock WebSocket implementation for testing
 */
export class MockWebSocket implements MinimalWebSocket {
  binaryType: BinaryType = 'blob';
  bufferedAmount: number = 0;
  extensions: string = '';
  protocol: string = '';
  readyState: number = 0; // CONNECTING
  url: string;

  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
  onerror: ((this: WebSocket, ev: Event) => any) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
  onopen: ((this: WebSocket, ev: Event) => any) | null = null;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  private listeners = new Map<string, Set<Function>>();
  private messageQueue: any[] = [];

  constructor(
    url: string | URL,
    protocols?: string | string[],
    autoOpen = true
  ) {
    this.url = url.toString();

    if (protocols) {
      this.protocol = Array.isArray(protocols) ? protocols[0] : protocols;
    }

    if (autoOpen) {
      setTimeout(() => this.simulateOpen(), 0);
    }
  }

  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    _options?: boolean | AddEventListenerOptions
  ): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    _options?: boolean | EventListenerOptions
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => {
        listener.call(this as any, event);
      });
    }

    // Also call direct event handlers
    const handler = (this as any)[`on${event.type}`];
    if (handler) {
      handler.call(this as any, event);
    }

    return true;
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === this.CLOSED || this.readyState === this.CLOSING) {
      return;
    }

    this.readyState = this.CLOSING;

    setTimeout(() => {
      this.readyState = this.CLOSED;
      const event = new CloseEvent('close', {
        code: code ?? 1000,
        reason: reason ?? '',
        wasClean: true,
      });
      this.dispatchEvent(event);
    }, 0);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== this.OPEN) {
      throw new Error('WebSocket is not open');
    }

    this.messageQueue.push(data);
  }

  // Test helper methods
  simulateOpen(): void {
    this.readyState = this.OPEN;
    const event = new Event('open');
    this.dispatchEvent(event);
  }

  simulateMessage(data: any): void {
    if (this.readyState !== this.OPEN) {
      throw new Error('WebSocket must be open to receive messages');
    }

    const event = new MessageEvent('message', { data });
    this.dispatchEvent(event);
  }

  simulateError(_error?: any): void {
    const event = new Event('error');
    this.dispatchEvent(event);
  }

  simulateClose(code = 1000, reason = ''): void {
    this.close(code, reason);
  }

  getMessageQueue(): any[] {
    return [...this.messageQueue];
  }

  clearMessageQueue(): void {
    this.messageQueue = [];
  }
}

/**
 * Factory function for creating mock WebSocket instances
 */
export const mockWebSocketFactory = (
  url: string | URL,
  protocols?: string | string[]
): MinimalWebSocket => {
  return new MockWebSocket(url, protocols);
};

/**
 * Configurable mock factory for advanced testing scenarios
 */
export class ConfigurableMockWebSocketFactory {
  private defaultOptions: {
    autoOpen?: boolean;
    openDelay?: number;
    failOnConnect?: boolean;
    errorOnSend?: boolean;
  } = {};

  constructor(
    options?: typeof ConfigurableMockWebSocketFactory.prototype.defaultOptions
  ) {
    if (options) {
      this.defaultOptions = options;
    }
  }

  create(url: string | URL, protocols?: string | string[]): MinimalWebSocket {
    const mock = new MockWebSocket(
      url,
      protocols,
      this.defaultOptions.autoOpen ?? true
    );

    if (this.defaultOptions.failOnConnect) {
      setTimeout(() => {
        mock.simulateError(new Error('Connection failed'));
        mock.simulateClose(1006, 'Connection failed');
      }, this.defaultOptions.openDelay ?? 0);
    }

    if (this.defaultOptions.errorOnSend) {
      const _originalSend = mock.send.bind(mock);
      mock.send = (_data) => {
        throw new Error('Send failed');
      };
    }

    return mock;
  }
}
