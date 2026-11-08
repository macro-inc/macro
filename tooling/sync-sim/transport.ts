// Native WebSocket port only: the shipping Websocket, Bebop serializer, framing,
// heartbeat and SyncServiceSource execute unchanged above this isolated transport.
import type { PeerEffect } from './generated';

export const effects: PeerEffect[] = [];
export const transports = new Map<string, SimTransport>();
export class SimTransport extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  binaryType: BinaryType = 'arraybuffer';
  readonly bufferedAmount = 0;
  readonly extensions = '';
  readonly protocol = '';
  readyState = SimTransport.CONNECTING;
  readonly client: string;
  readonly url: string;
  constructor(url: string | URL) {
    super();
    this.url = String(url);
    this.client = decodeURIComponent(new URL(url).pathname.slice(1));
    transports.set(this.client, this);
    queueMicrotask(() => {
      this.readyState = SimTransport.OPEN;
      this.dispatchEvent(new Event('open'));
    });
  }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== SimTransport.OPEN)
      throw new Error('send on closed simulated socket');
    if (typeof data === 'string') {
      effects.push({ type: 'text', client: this.client, text: data });
      return;
    }
    if (data instanceof Blob)
      throw new Error('Bebop transport unexpectedly sent a Blob');
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    effects.push({
      type: 'frame',
      client: this.client,
      bytes: Array.from(bytes),
    });
  }
  close(code = 1000, reason = ''): void {
    if (this.readyState === SimTransport.CLOSED) return;
    this.readyState = SimTransport.CLOSED;
    this.dispatchEvent(
      new CloseEvent('close', { code, reason, wasClean: code === 1000 })
    );
    effects.push({ type: 'closed', client: this.client });
  }
  receive(bytes: number[]): void {
    this.dispatchEvent(
      new MessageEvent('message', { data: Uint8Array.from(bytes).buffer })
    );
  }
  text(text: string): void {
    this.dispatchEvent(new MessageEvent('message', { data: text }));
  }
}
Object.defineProperty(globalThis, 'WebSocket', { value: SimTransport });
